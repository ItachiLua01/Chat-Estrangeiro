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
    audio.loop = true;
    audioRef.current = audio;

    const tryPlay = () => {
      audio.play().catch(() => {});
    };

    tryPlay();

    const unlockAudio = () => {
      tryPlay();
    };

    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });

    const handleDuck = (e: Event) => {
      const custom = e as CustomEvent<{ duck: boolean }>;
      if (!audioRef.current) return;
      audioRef.current.volume = custom.detail?.duck ? 0.05 : 0.3;
    };

    window.addEventListener("hexatombe-duck-audio", handleDuck);

    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      window.removeEventListener("hexatombe-duck-audio", handleDuck);
      audio.pause();
    };
  }, []);

  return (
    <>
      <Head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover"
        />
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
