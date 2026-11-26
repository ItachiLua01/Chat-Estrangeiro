import { NextPage } from "next";
import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import SocketIOClient from "socket.io-client";
import { Socket } from "socket.io-client";

import styles from "../styles/Room.module.scss";
import { Message } from "../types/message";

const MASTER_USER = "DM";
const MASTER_PASS = "DM";

const RoomPage: NextPage = () => {
  const router = useRouter();

  const { room, stranger } = router.query;
  const [masterMode, setMasterMode] = useState(false);
  const isStranger = !!stranger || masterMode;

  const [showLogin, setShowLogin] = useState(false);
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [error, setError] = useState(false);
  const [showPowerCard, setShowPowerCard] = useState(false);

  const [socket, setSocket] = useState<Socket | undefined>();
  const [messages, setMessages] = useState<Message[]>([]);

  const [clientMessage, setClientMessage] = useState<string>("");
  const [strangerMessage, setStrangerMessage] = useState<string>("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "M") {
        e.preventDefault();
        setShowLogin(true);
        setLoginUser("");
        setLoginPass("");
        setError(false);
      }
      if (e.key === "Escape") {
        setShowLogin(false);
        setShowPowerCard(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect((): any => {
    if (!room || !router) return;

    const io = SocketIOClient(process.env.API_BASE_URL as string, {
      path: "/api/socketio",
      extraHeaders: {
        room: room as string,
      },
    });

    io.on("connect", () => {
      setSocket(io);
    });

    io.on("message", (message: Message) => {
      setMessages((oldMessages) => [...oldMessages, message]);
    });

    io.on("clientMessage", (message: string) => {
      if (!isStranger) return;
      setClientMessage(message);
      });   
    
    io.on("togglePowerCard", (show: boolean) => {
      setShowPowerCard(show);
    });

    return () => io.disconnect();
  }, [room, router]);

  const submitLogin = () => {
    if (loginUser === MASTER_USER && loginPass === MASTER_PASS) {
      setMasterMode(true);
      setShowLogin(false);
    } else {
      setError(true);
    }
  };

  const sendMessage = async () => {
    if (isStranger ? !strangerMessage : !clientMessage) return;

    socket?.emit("sendMessage", {
      message: isStranger ? strangerMessage : clientMessage,
      room: room as string,
      stranger: isStranger,
    } as Message);

    if (isStranger) {
      setStrangerMessage("");
    } else {
      socket?.emit("clientMessage", clientMessage);
      setClientMessage("");
    }
  };

  const setUserMessage = (newMessage: string) => {
    setClientMessage(newMessage);
  };

  return (
    <>
      <Head>
        <title>Hexatombe</title>
      </Head>
      {!socket ? (
        <div className={styles.connecting}>
          <p className="text-glow">Conectando</p>
        </div>
      ) : (
        <section className={styles.program}>
          <div className={styles.messages}>
            {messages.map((message, index) => (
              <div
                key={index}
                className={message.stranger ? styles.stranger : styles.client}
              >
                <p className="text-glow">{!message.stranger && ">"}</p>
                <p className="text-glow">{message.message}</p>
              </div>
            ))}
          </div>
          <div className={styles.clientInput}>
            <p className="text-glow">{">"}</p>
            <input
              type="text"
              value={clientMessage}
              disabled={isStranger}
              onChange={(e) => setUserMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") sendMessage();
              }}
              className="text-glow"
            />
          </div>
          {isStranger && (
            <div className={styles.strangerInput}>
              <hr className="glow" />
              <input
                className="glow"
                type="text"
                value={strangerMessage}
                onChange={(e) => setStrangerMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") sendMessage();
                }}
              />
            </div>
          )}
          {isStranger && (
            <button
              type="button"
              className={styles.powerBtn}
              onClick={() => {
                const newState = !showPowerCard;
                setShowPowerCard(newState);
                socket?.emit("togglePowerCard", newState);
              }}
            >
              {showPowerCard ? "Ocultar" : "Poder"}
            </button>
          )}   

          {isStranger && showPowerCard && (
            <div className={styles.powerOverlay}>
              <div className={styles.powerCard}>
                <p className={styles.powerTitle}>PODER DE INTENÇÃO</p>
                <img
                  src="/power-intention.png"
                  alt="Intenção"
                  className={styles.powerImage}
                />
                <p className={styles.powerDesc}>
                  REAÇÃO Se Juan obedecer a Ele, ao fazer um teste, em vez de
                  rolar os dados, Juan pode determinar que seja um sucesso
                  automático (como se tivesse rolado 20 natural). Juan pode
                  fazer isso apenas uma vez por cena e precisa fazê-lo na mesma
                  cena em que obedeceu uma vontade d'Ele.
                </p>
              </div>
            </div>
          )}

          {showLogin && (
            <div className={styles.loginModal}>
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
              <p className={styles.loginHint}></p>
            </div>
          )}
        </section>
      )}
    </>
  );
};

export default RoomPage;   
