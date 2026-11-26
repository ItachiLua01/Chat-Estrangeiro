import { NextPage } from "next";
import Head from "next/head";
import { useRouter } from "next/router";
import { useState, useEffect } from "react";

import styles from "../styles/Home.module.scss";

const MASTER_USER = "Luna";
const MASTER_PASS = "Hexatombe";

const Home: NextPage = () => {
  const router = useRouter();
  const [room, setRoom] = useState<string>("");
  const [showLogin, setShowLogin] = useState(false);
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === "M") {
        e.preventDefault();
        setShowLogin(true);
        setLoginUser("");
        setLoginPass("");
        setError(false);
      }
      if (e.key === "Escape") setShowLogin(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const enterRoom = () => {
    if (!room) return;
    router.push(`/${room}`);
  };

  const submitLogin = () => {
    if (loginUser === MASTER_USER && loginPass === MASTER_PASS) {
      setShowLogin(false);
      router.push(
        { pathname: "/[room]", query: { room: "mestre", stranger: true } },
        "/mestre"
      );
    } else {
      setError(true);
    }
  };

  return (
    <>
      <Head>
        <title>Hexatombe</title>
      </Head>
      <section className={styles.main}>
        <input
          type="text"
          placeholder="Digite o código do ritual"
          onChange={(e) => setRoom(e.target.value)}
          value={room}
          className="glow"
        />
        <button
          type="button"
          disabled={!room}
          onClick={enterRoom}
          className="glow"
        >
          Entrar como usuário
        </button>

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
            <p className={styles.loginHint}>ESC para fechar</p>
          </div>
        )}
      </section>
    </>
  );
};

export default Home;   
