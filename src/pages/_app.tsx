import "../styles/globals.scss";
import type { AppProps } from "next/app";

import styles from "../styles/Monitor.module.scss";
import Head from "next/head";
import { useEffect, useRef } from "react";

export default function App({ Component, pageProps }: AppProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = new Audio("/zoom.mp3");
    audio.volume = 0.3;
    audioRef.current = audio;

    const interval = setInterval(() => {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }, 8000);

    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <Head>
        <link rel="shortcut icon" href="/favicon.ico" />
      </Head>
      <main className={styles.monitor}>
        <section className={styles.scan} />
        <section className={styles.main}>
          <Component {...pageProps} />
        </section>
      </main>
    </>
  );
}   
