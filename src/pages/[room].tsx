import { NextPage } from "next";
import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import SocketIOClient, { Socket } from "socket.io-client";

import styles from "../styles/Room.module.scss";
import { CardId, ChoicePrompt, Message, RoomState } from "../types/message";

const MASTER_USER = "DM";
const MASTER_PASS = "DM";

interface CardDefinition {
  id: CardId;
  label: string;
  title: string;
  image?: string;
  description: string;
}

const CARDS: Record<CardId, CardDefinition> = {
  intencao: {
    id: "intencao",
    label: "Intenção",
    title: "PODER DE INTENÇÃO",
    image: "/power-intention.png",
    description:
      "REAÇÃO Se Juan obedecer a Ele, ao fazer um teste, em vez de rolar os dados, Juan pode determinar que seja um sucesso automático (como se tivesse rolado 20 natural). Juan pode fazer isso apenas uma vez por cena e precisa fazê-lo na mesma cena em que obedeceu uma vontade d'Ele.",
  },
  estigma: {
    id: "estigma",
    label: "Estigma",
    title: "ESTIGMA DO SACRIFÍCIO",
    description:
      "O sinal queima sob a pele. Enquanto outro sacrifício respirar sob a mesma lua, a coroa exige sangue. Se mais de um cair na mesma noite, o sobrevivente herda o fardo e a intenção do que tombou.",
  },
  pacto: {
    id: "pacto",
    label: "Pacto",
    title: "CLÁUSULA DE SANGUE",
    description:
      "Você já entregou o primeiro passo. Recusar a vontade d'Ele não apaga a dívida — apenas cobra juros na sua carne e na daqueles que caminham ao seu lado.",
  },
  memoria: {
    id: "memoria",
    label: "Memória",
    title: "FRAGMENTO DE RECEPTÁCULO",
    description:
      "Um lampejo atravessa o véu: mãos cobertas de sangue que não parecem suas, um nome sussurrado antes do ritual e a certeza de que este corpo já matou antes de você acordar nele.",
  },
};

interface MessageRowProps {
  msg: Message;
  animate: boolean;
  isMaster: boolean;
  onTick?: () => void;
}

const MessageRow = ({ msg, animate, isMaster, onTick }: MessageRowProps) => {
  const [displayed, setDisplayed] = useState(animate ? "" : msg.message);
  const [doneTyping, setDoneTyping] = useState(!animate);
  const [mutated, setMutated] = useState(false);
  const [vanished, setVanished] = useState(false);

  useEffect(() => {
    if (!animate || !msg.stranger) {
      setDisplayed(msg.message);
      setDoneTyping(true);
      return;
    }

    let i = 0;
    setDisplayed("");
    setDoneTyping(false);

    const interval = setInterval(() => {
      i += 1;
      setDisplayed(msg.message.slice(0, i));
      onTick?.();
      if (i >= msg.message.length) {
        clearInterval(interval);
        setDoneTyping(true);
      }
    }, 36);

    return () => clearInterval(interval);
  }, [msg.id, msg.message, msg.stranger, animate]);

  useEffect(() => {
    if (!doneTyping || !msg.mutateTo) return;
    const t = setTimeout(() => {
      setMutated(true);
      setDisplayed(msg.mutateTo || msg.message);
    }, 3500);
    return () => clearTimeout(t);
  }, [doneTyping, msg.mutateTo, msg.message]);

  useEffect(() => {
    if (!doneTyping || !msg.ephemeral) return;
    const t = setTimeout(() => {
      setVanished(true);
    }, 6000);
    return () => clearTimeout(t);
  }, [doneTyping, msg.ephemeral]);

  if (vanished) {
    if (!isMaster) return null;
    return (
      <div className={`${styles.stranger} ${styles.vanishedMessage}`}>
        <p />
        <p>[sussurro dissipado] - {msg.message}</p>
      </div>
    );
  }

  return (
    <div
      className={`${msg.stranger ? styles.stranger : styles.client} ${
        msg.stranger ? styles.glitchText : ""
      } ${mutated ? styles.mutatedFlash : ""} ${
        msg.ephemeral && doneTyping ? styles.ephemeralFade : ""
      }`}
    >
      <p className="text-glow">{!msg.stranger && ">"}</p>
      <p className="text-glow">{displayed}</p>
    </div>
  );
};

interface ChoiceLog {
  room: string;
  prompt: string;
  chosen: string;
  timestamp: number;
}

const RoomPage: NextPage = () => {
  const router = useRouter();
  const { room, stranger } = router.query;

  const [masterMode, setMasterMode] = useState(false);
  const isStranger = !!stranger || masterMode;
  const isStrangerRef = useRef(isStranger);
  isStrangerRef.current = isStranger;

  const [showLogin, setShowLogin] = useState(false);
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [error, setError] = useState(false);

  const [activeCard, setActiveCard] = useState<CardId | null>(null);
  const [unlockedCards, setUnlockedCards] = useState<CardId[]>([]);
  const [showKnowledgeIndex, setShowKnowledgeIndex] = useState(false);
  const [localPreviewCard, setLocalPreviewCard] = useState<CardId | null>(null);

  const [isLocked, setIsLocked] = useState(false);
  const [liveTyping, setLiveTyping] = useState("");
  const [invasionActive, setInvasionActive] = useState(false);
  const [invasionShaking, setInvasionShaking] = useState(false);
  const [showMoldura, setShowMoldura] = useState(false);
  const hasScreamedRef = useRef(false);

  const bellAudioRef = useRef<HTMLAudioElement | null>(null);
  const bellSynthCtxRef = useRef<AudioContext | null>(null);
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Gesto secreto de 5 toques no canto superior esquerdo para abrir login no celular/tablet
  const secretTapCountRef = useRef(0);
  const secretTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [socket, setSocket] = useState<Socket | undefined>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [animatedIds, setAnimatedIds] = useState<Set<string>>(new Set());
  const [choiceLogs, setChoiceLogs] = useState<ChoiceLog[]>([]);

  const [clientMessage, setClientMessage] = useState("");
  const [strangerMessage, setStrangerMessage] = useState("");
  const [ephemeralNext, setEphemeralNext] = useState(false);
  const [mutateMode, setMutateMode] = useState(false);

  // Impulso / Pacto com timer
  const [showChoiceBuilder, setShowChoiceBuilder] = useState(false);
  const [choicePromptInput, setChoicePromptInput] = useState("");
  const [choiceOptA, setChoiceOptA] = useState("Obedecer");
  const [choiceOptB, setChoiceOptB] = useState("Resistir");
  const [choiceSeconds, setChoiceSeconds] = useState(15);
  const [activeChoice, setActiveChoice] = useState<ChoicePrompt | null>(null);
  const [choiceRemaining, setChoiceRemaining] = useState(0);

  // Salas e controle manual da Lua de Sangue
  const [knownRooms, setKnownRooms] = useState<string[]>([]);
  const [roomInput, setRoomInput] = useState("");
  const [moonFrom, setMoonFrom] = useState("6");
  const [moonTo, setMoonTo] = useState("5");

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const strangerInputRef = useRef<HTMLInputElement | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, liveTyping, activeChoice, choiceLogs]);

  const handleSecretTap = () => {
    secretTapCountRef.current += 1;
    if (secretTapTimerRef.current) clearTimeout(secretTapTimerRef.current);

    if (secretTapCountRef.current >= 5) {
      secretTapCountRef.current = 0;
      setShowLogin(true);
      setLoginUser("");
      setLoginPass("");
      setError(false);
      return;
    }

    secretTapTimerRef.current = setTimeout(() => {
      secretTapCountRef.current = 0;
    }, 1800);
  };

  const stopBellAndInvasion = () => {
    if (shakeTimerRef.current) {
      clearTimeout(shakeTimerRef.current);
      shakeTimerRef.current = null;
    }
    if (bellAudioRef.current) {
      bellAudioRef.current.pause();
      bellAudioRef.current.currentTime = 0;
      bellAudioRef.current = null;
    }
    if (bellSynthCtxRef.current) {
      bellSynthCtxRef.current.close().catch(() => {});
      bellSynthCtxRef.current = null;
    }
    setInvasionShaking(false);
    setInvasionActive(false);
  };

  const startBellAndInvasion = () => {
    stopBellAndInvasion();
    setInvasionActive(true);
    setInvasionShaking(true);

    shakeTimerRef.current = setTimeout(() => {
      setInvasionShaking(false);
    }, 2600);

    const audio = new Audio("/sino.mp3");
    audio.volume = 0.85;
    bellAudioRef.current = audio;

    audio.addEventListener(
      "ended",
      () => {
        setInvasionActive(false);
        setInvasionShaking(false);
        bellAudioRef.current = null;
      },
      { once: true }
    );

    audio.play().catch(() => {
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const ctx = new AudioCtx();
        bellSynthCtxRef.current = ctx;
        const now = ctx.currentTime;
        const freqs = [110, 220, 277.18, 440, 659.25];
        freqs.forEach((f, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = idx === 0 ? "triangle" : "sine";
          osc.frequency.setValueAtTime(f, now);
          gain.gain.setValueAtTime(0.18 / (idx + 1), now);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 2.5);
        });
        setTimeout(() => {
          setInvasionActive(false);
        }, 2500);
      } catch {
        setTimeout(() => {
          setInvasionActive(false);
        }, 2500);
      }
    });
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "ç") {
        e.preventDefault();
        setShowLogin(true);
        setLoginUser("");
        setLoginPass("");
        setError(false);
      }
      if (e.key === "Escape") {
        setShowLogin(false);
        setActiveCard(null);
        setLocalPreviewCard(null);
        setShowKnowledgeIndex(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const triggerFirstScream = () => {
    if (hasScreamedRef.current || isStrangerRef.current) return;
    hasScreamedRef.current = true;
    setShowMoldura(true);

    window.dispatchEvent(
      new CustomEvent("hexatombe-duck-audio", { detail: { duck: true } })
    );

    const scream = new Audio("/grito_5s.mp3");
    scream.volume = 0.9;

    const restore = () => {
      window.dispatchEvent(
        new CustomEvent("hexatombe-duck-audio", { detail: { duck: false } })
      );
      setTimeout(() => setShowMoldura(false), 600);
    };

    scream.addEventListener("ended", restore, { once: true });
    scream.play().catch(() => {});

    setTimeout(restore, 5200);
  };

  useEffect((): any => {
    if (!room || !router.isReady) return;

    const roomStr = Array.isArray(room) ? room[0] : room;
    setRoomInput(roomStr);
    hasScreamedRef.current = false;
    setAnimatedIds(new Set());
    stopBellAndInvasion();

    const io = SocketIOClient({
      path: "/api/socketio",
      extraHeaders: {
        room: roomStr,
      },
    });

    io.on("connect", () => {
      setSocket(io);
      io.emit("requestRoomsList");
    });

    io.on("roomState", (state: RoomState) => {
      setMessages(state.messages || []);
      setIsLocked(!!state.locked);
      setActiveCard(state.activeCard || null);
      setUnlockedCards(state.unlockedCards || []);
      setActiveChoice(state.activeChoice || null);
      setLiveTyping("");
    });

    io.on("roomsList", (rooms: string[]) => {
      setKnownRooms(rooms);
    });

    io.on("message", (message: Message) => {
      if (message.stranger) {
        triggerFirstScream();
      } else {
        setLiveTyping("");
      }
      setAnimatedIds((prev) => {
        const next = new Set(prev);
        next.add(message.id);
        return next;
      });
      setMessages((old) => [...old, message]);
    });

    io.on("typingPreview", (text: string) => {
      if (!isStrangerRef.current) return;
      setLiveTyping(text);
    });

    io.on("lockState", (locked: boolean) => {
      setIsLocked(locked);
    });

    io.on("activeCard", (cardId: CardId | null) => {
      setActiveCard(cardId);
    });

    io.on("unlockedCards", (cards: CardId[]) => {
      setUnlockedCards(cards);
    });

    io.on("triggerInvasion", () => {
      startBellAndInvasion();
    });

    io.on("stopInvasion", () => {
      stopBellAndInvasion();
    });

    io.on("resetFirstScream", () => {
      hasScreamedRef.current = false;
    });

    io.on("activeChoice", (choice: ChoicePrompt | null) => {
      setActiveChoice(choice);
    });

    io.on("choiceResult", (log: ChoiceLog) => {
      if (!isStrangerRef.current) return;
      setChoiceLogs((prev) => [...prev, log]);
    });

    return () => {
      stopBellAndInvasion();
      io.disconnect();
      setSocket(undefined);
    };
  }, [room, router.isReady]);

  // Contador regressivo da escolha/pacto
  useEffect(() => {
    if (!activeChoice) {
      setChoiceRemaining(0);
      return;
    }

    const updateTimer = () => {
      const elapsed = Math.floor((Date.now() - activeChoice.createdAt) / 1000);
      const left = Math.max(0, activeChoice.seconds - elapsed);
      setChoiceRemaining(left);
      if (left === 0 && !isStrangerRef.current) {
        socket?.emit("resolveChoice", {
          choiceId: activeChoice.id,
          chosen: "TEMPO ESGOTADO (Hesitou)",
        });
      }
    };

    updateTimer();
    const timer = setInterval(updateTimer, 250);
    return () => clearInterval(timer);
  }, [activeChoice, socket]);

  const submitLogin = () => {
    if (loginUser === MASTER_USER && loginPass === MASTER_PASS) {
      setMasterMode(true);
      setShowLogin(false);
      socket?.emit("requestRoomsList");
    } else {
      setError(true);
    }
  };

  const sendMessage = (broadcastAll = false) => {
    const roomStr = (Array.isArray(room) ? room[0] : room) || "intencao";
    if (isStranger) {
      if (!strangerMessage.trim()) return;

      let mainText = strangerMessage;
      let mutateTo: string | undefined;

      if (strangerMessage.includes("||")) {
        const parts = strangerMessage.split("||");
        mainText = parts[0].trim();
        mutateTo = parts.slice(1).join("||").trim() || undefined;
      }

      const payload: Message = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        message: mainText,
        room: roomStr,
        stranger: true,
        ephemeral: ephemeralNext,
        mutateTo,
        timestamp: Date.now(),
      };

      if (broadcastAll) {
        socket?.emit("broadcastAll", payload);
      } else {
        socket?.emit("sendMessage", payload);
      }

      setStrangerMessage("");
      setEphemeralNext(false);
      setMutateMode(false);
    } else {
      if (isLocked || !clientMessage.trim()) return;
      socket?.emit("sendMessage", {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        message: clientMessage,
        room: roomStr,
        stranger: false,
        timestamp: Date.now(),
      } as Message);
      socket?.emit("typingPreview", "");
      setClientMessage("");
    }
  };

  const handleClientChange = (val: string) => {
    if (isLocked || isStranger) return;
    setClientMessage(val);
    socket?.emit("typingPreview", val);
  };

  const handleToggleMutateHelper = () => {
    if (!strangerMessage.includes("||")) {
      setStrangerMessage((prev) =>
        prev ? `${prev} || ` : "texto inicial || texto alterado"
      );
    }
    setMutateMode((prev) => !prev);
    strangerInputRef.current?.focus();
  };

  const handleSendChoice = (allRooms = false) => {
    if (!choicePromptInput.trim()) return;
    const choice: ChoicePrompt = {
      id: `${Date.now()}`,
      prompt: choicePromptInput.trim(),
      optionA: choiceOptA.trim() || "Obedecer",
      optionB: choiceOptB.trim() || "Resistir",
      seconds: Math.max(5, Math.min(120, Number(choiceSeconds) || 15)),
      createdAt: Date.now(),
    };
    if (allRooms) {
      socket?.emit("sendChoiceAll", choice);
    } else {
      socket?.emit("sendChoice", choice);
    }
    setShowChoiceBuilder(false);
    setChoicePromptInput("");
  };

  const handleToggleCard = (cardId: CardId) => {
    const next = activeCard === cardId ? null : cardId;
    setActiveCard(next);
    socket?.emit("showCard", next);
  };

  const handleTriggerBloodMoon = () => {
    const fromVal = moonFrom.trim() || "6";
    const toVal = moonTo.trim() || "5";
    socket?.emit("triggerBloodMoon", { from: fromVal, to: toVal });
    const numericTo = parseInt(toVal, 10);
    if (!Number.isNaN(numericTo)) {
      setMoonFrom(String(numericTo));
      setMoonTo(String(Math.max(0, numericTo - 1)));
    }
  };

  const switchRoom = (target: string) => {
    const clean = target.trim().toLowerCase().replace(/\s+/g, "-");
    if (!clean) return;
    router.push(`/${clean}${stranger ? "?stranger=1" : ""}`);
  };

  const handleDeleteRoom = (targetRoom: string) => {
    socket?.emit("deleteRoom", targetRoom);
    if (targetRoom === room) {
      const fallback = knownRooms.find((r) => r !== targetRoom) || "intencao";
      if (fallback !== targetRoom) {
        switchRoom(fallback);
      }
    }
  };

  const displayedCardId = localPreviewCard || activeCard;
  const currentCard = displayedCardId ? CARDS[displayedCardId] : null;

  return (
    <>
      <Head>
        <title>Hexatombe</title>
      </Head>

      {/* Área secreta no canto superior esquerdo: 5 toques rápidos abrem login no mobile/tablet */}
      <div
        className={styles.secretLoginTouch}
        onClick={handleSecretTap}
        aria-hidden="true"
      />

      {invasionShaking && <div className={styles.invasionFlash} />}
      {showMoldura && (
        <div className={styles.molduraOverlay}>
          <img src="/moldura.png" alt="" className={styles.molduraImg} />
        </div>
      )}

      {!socket ? (
        <div className={styles.connecting}>
          <img
            src="/hexatombe-sigil.png"
            alt="Hexatombe"
            className={styles.connectingSigil}
          />
          <p className="text-glow">Conectando</p>
        </div>
      ) : (
        <section
          className={`${styles.program} ${
            invasionShaking ? styles.screenShake : ""
          }`}
        >
          {/* Botão discreto de Conhecimento (dourado) para o Índice de Poderes */}
          <button
            type="button"
            className={styles.knowledgeBtn}
            title="Índice de Conhecimento"
            onClick={() => setShowKnowledgeIndex(true)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
              <path d="M12 4C6.5 4 2.2 8 1 12c1.2 4 5.5 8 11 8s9.8-4 11-8c-1.2-4-5.5-8-11-8Z" />
              <circle cx="12" cy="12" r="3.2" />
            </svg>
          </button>

          {isStranger && (
            <div className={styles.masterTopBar}>
              <span className={styles.masterTag}>MESTRE · SALA: {room}</span>
              <div className={styles.roomChips}>
                {Array.from(
                  new Set([...knownRooms, String(room || "intencao")])
                ).map((r) => (
                  <div
                    key={r}
                    className={`${styles.roomChipWrap} ${
                      r === room ? styles.roomChipActive : ""
                    }`}
                  >
                    <button
                      type="button"
                      className={styles.roomChipBtn}
                      onClick={() => switchRoom(r)}
                    >
                      {r}
                    </button>
                    <button
                      type="button"
                      className={styles.roomDeleteBtn}
                      title={`Apagar sala ${r}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteRoom(r);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <div className={styles.roomSwitchForm}>
                <input
                  type="text"
                  value={roomInput}
                  onChange={(e) => setRoomInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && switchRoom(roomInput)}
                  placeholder="nova sala..."
                />
                <button type="button" onClick={() => switchRoom(roomInput)}>
                  Ir
                </button>
              </div>
            </div>
          )}

          <div className={styles.messages}>
            {messages.map((message) => (
              <MessageRow
                key={message.id}
                msg={message}
                animate={animatedIds.has(message.id)}
                isMaster={isStranger}
                onTick={scrollToBottom}
              />
            ))}

            {isStranger &&
              choiceLogs.map((log, i) => (
                <div
                  key={`${log.timestamp}-${i}`}
                  className={styles.masterChoiceLog}
                >
                  <p>[IMPULSO · {log.room}]</p>
                  <p>
                    &ldquo;{log.prompt}&rdquo; → {log.chosen}
                  </p>
                </div>
              ))}

            {isStranger && liveTyping && (
              <div className={`${styles.client} ${styles.liveTypingPreview}`}>
                <p className="text-glow">{">"}</p>
                <p className="text-glow">
                  {liveTyping}
                  <span className={styles.typingCursor}>_</span>
                </p>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {(!isLocked || isStranger) && (
            <div
              className={`${styles.clientInput} ${
                isLocked ? styles.clientInputLocked : ""
              }`}
            >
              <p className="text-glow">{">"}</p>
              <input
                type="text"
                value={
                  isStranger
                    ? isLocked
                      ? "[CHAT DO JOGADOR TRAVADO]"
                      : liveTyping
                      ? `Digitando: ${liveTyping}`
                      : ""
                    : clientMessage
                }
                disabled={isStranger || isLocked}
                placeholder={
                  isStranger ? "Aguardando jogador..." : "Escreva sua resposta..."
                }
                onChange={(e) => handleClientChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") sendMessage(false);
                }}
                className="text-glow"
              />
            </div>
          )}

          {isStranger && (
            <div className={styles.strangerZone}>
              {showChoiceBuilder && (
                <div className={styles.choiceBuilder}>
                  <input
                    type="text"
                    placeholder="Ordem / Impulso d'Ele..."
                    value={choicePromptInput}
                    onChange={(e) => setChoicePromptInput(e.target.value)}
                  />
                  <div className={styles.choiceBuilderRow}>
                    <input
                      type="text"
                      placeholder="Opção 1"
                      value={choiceOptA}
                      onChange={(e) => setChoiceOptA(e.target.value)}
                    />
                    <input
                      type="text"
                      placeholder="Opção 2"
                      value={choiceOptB}
                      onChange={(e) => setChoiceOptB(e.target.value)}
                    />
                    <input
                      type="number"
                      min={5}
                      max={120}
                      value={choiceSeconds}
                      onChange={(e) => setChoiceSeconds(Number(e.target.value))}
                      title="Segundos"
                    />
                    <button type="button" onClick={() => handleSendChoice(false)}>
                      Enviar Sala
                    </button>
                    <button type="button" onClick={() => handleSendChoice(true)}>
                      Todas Salas
                    </button>
                  </div>
                </div>
              )}

              <div className={styles.strangerInput}>
                <hr className="glow" />
                <div className={styles.strangerInputWrap}>
                  <input
                    ref={strangerInputRef}
                    className="glow"
                    type="text"
                    placeholder={
                      ephemeralNext
                        ? "Mensagem efêmera (apaga em 6s)..."
                        : "Falar na mente do jogador... (use || para mutar texto)"
                    }
                    value={strangerMessage}
                    onChange={(e) => setStrangerMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") sendMessage(false);
                    }}
                  />
                  <div className={styles.inlineTools}>
                    <button
                      type="button"
                      title="Mensagem efêmera (apaga em 6s)"
                      className={`${styles.inlineIconBtn} ${
                        ephemeralNext ? styles.inlineIconActive : ""
                      }`}
                      onClick={() => setEphemeralNext((v) => !v)}
                    >
                      †
                    </button>
                    <button
                      type="button"
                      title="Mutar texto após 3.5s (separe com ||)"
                      className={`${styles.inlineIconBtn} ${
                        mutateMode || strangerMessage.includes("||")
                          ? styles.inlineIconActive
                          : ""
                      }`}
                      onClick={handleToggleMutateHelper}
                    >
                      ⇄
                    </button>
                  </div>
                </div>
              </div>

              <div className={styles.masterControls}>
                <div className={styles.controlGroup}>
                  {(Object.keys(CARDS) as CardId[]).map((cid) => (
                    <button
                      key={cid}
                      type="button"
                      className={`${styles.ctrlBtn} ${
                        activeCard === cid ? styles.ctrlBtnActive : ""
                      }`}
                      onClick={() => handleToggleCard(cid)}
                    >
                      {CARDS[cid].label}
                    </button>
                  ))}
                </div>

                <div className={styles.controlGroup}>
                  <button
                    type="button"
                    className={`${styles.ctrlBtn} ${
                      isLocked ? styles.ctrlBtnActive : ""
                    }`}
                    onClick={() => socket?.emit("toggleLock", !isLocked)}
                  >
                    {isLocked ? "Destravar" : "Travar"}
                  </button>
                  <button
                    type="button"
                    className={`${styles.ctrlBtn} ${
                      invasionActive ? styles.ctrlBtnActive : ""
                    }`}
                    onClick={() =>
                      socket?.emit(
                        invasionActive ? "stopInvasion" : "triggerInvasion"
                      )
                    }
                  >
                    {invasionActive ? "Parar Sino" : "Sino / Invasão"}
                  </button>
                  <button
                    type="button"
                    className={`${styles.ctrlBtn} ${
                      showChoiceBuilder ? styles.ctrlBtnActive : ""
                    }`}
                    onClick={() => setShowChoiceBuilder((v) => !v)}
                  >
                    Impulso
                  </button>
                  <button
                    type="button"
                    className={styles.ctrlBtn}
                    onClick={() => sendMessage(true)}
                    title="Enviar o texto atual para todas as salas ativas"
                  >
                    Todas Salas
                  </button>
                  <div className={styles.moonManualWrap}>
                    <input
                      type="text"
                      value={moonFrom}
                      onChange={(e) => setMoonFrom(e.target.value)}
                      className={styles.moonNumInput}
                      title="Número inicial da Lua"
                    />
                    <span>→</span>
                    <input
                      type="text"
                      value={moonTo}
                      onChange={(e) => setMoonTo(e.target.value)}
                      className={styles.moonNumInput}
                      title="Novo número da Lua"
                    />
                    <button
                      type="button"
                      className={styles.ctrlBtn}
                      onClick={handleTriggerBloodMoon}
                      title="Disparar overlay da Lua de Sangue nos tablets Android"
                    >
                      Lua
                    </button>
                  </div>
                  <button
                    type="button"
                    className={styles.ctrlBtn}
                    onClick={() => socket?.emit("resetFirstScream")}
                    title="Permite disparar moldura.png + grito_5s.mp3 novamente"
                  >
                    Reset 1º Grito
                  </button>
                  <button
                    type="button"
                    className={styles.ctrlBtn}
                    onClick={() => {
                      socket?.emit("clearRoom");
                      setChoiceLogs([]);
                    }}
                  >
                    Limpar
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Índice de Conhecimento (cartas descobertas e bloqueadas) */}
          {showKnowledgeIndex && (
            <div
              className={styles.indexOverlay}
              onClick={() => setShowKnowledgeIndex(false)}
            >
              <div
                className={styles.indexModal}
                onClick={(e) => e.stopPropagation()}
              >
                <p className={styles.indexTitle}>ÍNDICE DE CONHECIMENTO</p>
                <div className={styles.indexGrid}>
                  {(Object.keys(CARDS) as CardId[]).map((cid) => {
                    const unlocked = isStranger || unlockedCards.includes(cid);
                    const card = CARDS[cid];
                    return unlocked ? (
                      <button
                        key={cid}
                        type="button"
                        className={styles.indexCardUnlocked}
                        onClick={() => {
                          setShowKnowledgeIndex(false);
                          setLocalPreviewCard(cid);
                        }}
                      >
                        <img
                          src={card.image || "/hexatombe-sigil.png"}
                          alt={card.title}
                          className={styles.indexCardThumb}
                        />
                        <span className={styles.indexCardName}>{card.title}</span>
                      </button>
                    ) : (
                      <div key={cid} className={styles.indexCardLocked}>
                        <img
                          src={card.image || "/hexatombe-sigil.png"}
                          alt=""
                          className={styles.indexCardSilhouette}
                        />
                        <span className={styles.indexQuestion}>?</span>
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className={styles.closeCardBtn}
                  onClick={() => setShowKnowledgeIndex(false)}
                >
                  Fechar
                </button>
              </div>
            </div>
          )}

          {currentCard && (
            <div
              className={styles.powerOverlay}
              onClick={() => {
                setLocalPreviewCard(null);
                setActiveCard(null);
                if (isStranger && activeCard) socket?.emit("showCard", null);
              }}
            >
              <div
                className={styles.powerCard}
                onClick={(e) => e.stopPropagation()}
              >
                <p className={styles.powerTitle}>{currentCard.title}</p>
                {currentCard.image && (
                  <img
                    src={currentCard.image}
                    alt={currentCard.title}
                    className={styles.powerImage}
                  />
                )}
                <p className={styles.powerDesc}>{currentCard.description}</p>
                <button
                  type="button"
                  className={styles.closeCardBtn}
                  onClick={() => {
                    setLocalPreviewCard(null);
                    setActiveCard(null);
                    if (isStranger && activeCard) socket?.emit("showCard", null);
                  }}
                >
                  Fechar
                </button>
              </div>
            </div>
          )}

          {activeChoice && (
            <div className={styles.choiceOverlay}>
              <div className={styles.choiceModal}>
                <p className={styles.choiceTimer}>{choiceRemaining}s</p>
                <p className={styles.choicePromptText}>{activeChoice.prompt}</p>
                <div className={styles.choiceBarTrack}>
                  <div
                    className={styles.choiceBarFill}
                    style={{
                      width: `${
                        (choiceRemaining / Math.max(1, activeChoice.seconds)) * 100
                      }%`,
                    }}
                  />
                </div>
                {!isStranger ? (
                  <div className={styles.choiceActions}>
                    <button
                      type="button"
                      onClick={() =>
                        socket?.emit("resolveChoice", {
                          choiceId: activeChoice.id,
                          chosen: activeChoice.optionA,
                        })
                      }
                    >
                      {activeChoice.optionA}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        socket?.emit("resolveChoice", {
                          choiceId: activeChoice.id,
                          chosen: activeChoice.optionB,
                        })
                      }
                    >
                      {activeChoice.optionB}
                    </button>
                  </div>
                ) : (
                  <p className={styles.choiceWaitHint}>
                    Aguardando escolha do jogador...
                  </p>
                )}
              </div>
            </div>
          )}

          {showLogin && (
            <div
              className={styles.loginOverlay}
              onClick={() => setShowLogin(false)}
            >
              <div
                className={styles.loginModal}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="text"
                  placeholder="Usuário"
                  value={loginUser}
                  onChange={(e) => setLoginUser(e.target.value)}
                  className="glow"
                  autoFocus
                />
                <input
                  type="password"
                  placeholder="Senha"
                  value={loginPass}
                  onChange={(e) => setLoginPass(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitLogin()}
                  className="glow"
                />
                <button type="button" onClick={submitLogin} className="glow">
                  Entrar
                </button>
                {error && <p className={styles.loginError}>Acesso negado</p>}
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
};

export default RoomPage;
