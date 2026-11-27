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

function playBellSound() {
  const audio = new Audio("/sino.mp3");
  audio.volume = 0.85;
  audio.play().catch(() => {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioCtx();
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
    } catch {
      // Silencioso se o navegador bloquear áudio
    }
  });
}

interface MessageRowProps {
  msg: Message;
  animate: boolean;
  onTick?: () => void;
}

const MessageRow = ({ msg, animate, onTick }: MessageRowProps) => {
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
    return (
      <div className={`${styles.stranger} ${styles.vanishedMessage}`}>
        <p />
        <p>[sussurro dissipado]</p>
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
  const [isLocked, setIsLocked] = useState(false);
  const [liveTyping, setLiveTyping] = useState("");
  const [invasionActive, setInvasionActive] = useState(false);
  const [showMoldura, setShowMoldura] = useState(false);
  const hasScreamedRef = useRef(false);

  const [socket, setSocket] = useState<Socket | undefined>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [animatedIds, setAnimatedIds] = useState<Set<string>>(new Set());

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

  // Salas para o mestre alternar sem abrir várias abas
  const [knownRooms, setKnownRooms] = useState<string[]>([]);
  const [roomInput, setRoomInput] = useState("");

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const strangerInputRef = useRef<HTMLInputElement | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, liveTyping, activeChoice]);

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

    io.on("triggerInvasion", () => {
      setInvasionActive(true);
      playBellSound();
      setTimeout(() => setInvasionActive(false), 2600);
    });

    io.on("resetFirstScream", () => {
      hasScreamedRef.current = false;
    });

    io.on("activeChoice", (choice: ChoicePrompt | null) => {
      setActiveChoice(choice);
    });

    return () => {
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
      setStrangerMessage((prev) => (prev ? `${prev} || ` : "texto inicial || texto alterado"));
    }
    setMutateMode((prev) => !prev);
    strangerInputRef.current?.focus();
  };

  const handleSendChoice = () => {
    if (!choicePromptInput.trim()) return;
    const choice: ChoicePrompt = {
      id: `${Date.now()}`,
      prompt: choicePromptInput.trim(),
      optionA: choiceOptA.trim() || "Obedecer",
      optionB: choiceOptB.trim() || "Resistir",
      seconds: Math.max(5, Math.min(120, Number(choiceSeconds) || 15)),
      createdAt: Date.now(),
    };
    socket?.emit("sendChoice", choice);
    setShowChoiceBuilder(false);
    setChoicePromptInput("");
  };

  const handleToggleCard = (cardId: CardId) => {
    const next = activeCard === cardId ? null : cardId;
    setActiveCard(next);
    socket?.emit("showCard", next);
  };

  const switchRoom = (target: string) => {
    const clean = target.trim().toLowerCase().replace(/\s+/g, "-");
    if (!clean) return;
    router.push(`/${clean}${stranger ? "?stranger=1" : ""}`);
  };

  const currentCard = activeCard ? CARDS[activeCard] : null;

  return (
    <>
      <Head>
        <title>Hexatombe</title>
      </Head>

      {invasionActive && <div className={styles.invasionFlash} />}
      {showMoldura && (
        <div className={styles.molduraOverlay}>
          <img src="/moldura.png" alt="" className={styles.molduraImg} />
        </div>
      )}

      {!socket ? (
        <div className={styles.connecting}>
          <p className="text-glow">Conectando</p>
        </div>
      ) : (
        <section
          className={`${styles.program} ${
            invasionActive ? styles.screenShake : ""
          }`}
        >
          {isStranger && (
            <div className={styles.masterTopBar}>
              <span className={styles.masterTag}>MESTRE · SALA: {room}</span>
              <div className={styles.roomChips}>
                {Array.from(
                  new Set([...knownRooms, String(room || "intencao")])
                ).map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={`${styles.roomChip} ${
                      r === room ? styles.roomChipActive : ""
                    }`}
                    onClick={() => switchRoom(r)}
                  >
                    {r}
                  </button>
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
                onTick={scrollToBottom}
              />
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

          {/* Caixa do jogador: oculta quando travada para o jogador */}
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
                    <button type="button" onClick={handleSendChoice}>
                      Enviar
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
                    className={styles.ctrlBtn}
                    onClick={() => socket?.emit("triggerInvasion")}
                  >
                    Sino / Invasão
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
                    onClick={() => socket?.emit("clearRoom")}
                  >
                    Limpar
                  </button>
                </div>
              </div>
            </div>
          )}

          {currentCard && (
            <div
              className={styles.powerOverlay}
              onClick={() => {
                setActiveCard(null);
                if (isStranger) socket?.emit("showCard", null);
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
                    setActiveCard(null);
                    if (isStranger) socket?.emit("showCard", null);
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
                <p className={styles.choiceTimer}>
                  {choiceRemaining}s
                </p>
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
            <div className={styles.loginOverlay} onClick={() => setShowLogin(false)}>
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
