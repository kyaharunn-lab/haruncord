"use client"

import { useState, useEffect } from 'react';
import { LoginScreen } from '@/components/LoginScreen';
import { MainApp } from '@/components/MainApp';
import { useAuth } from '@/firebase';
import { signInAnonymously } from 'firebase/auth';

export default function Home() {
  const [userName, setUserName] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const auth = useAuth();

  useEffect(() => {
    // Initial check for stored data
    const storedName = localStorage.getItem('kanka_voice_user');
    let storedId = localStorage.getItem('kanka_voice_user_id');
    
    if (storedName) {
      setUserName(storedName);
    }
    
    if (!storedId) {
      storedId = Math.random().toString(36).substring(2, 15);
      localStorage.setItem('kanka_voice_user_id', storedId);
    }
    setUserId(storedId);

    // Sign in anonymously to satisfy security rules
    if (auth) {
      signInAnonymously(auth).catch((err) => {
        // Hata durumunda sadece konsola sessizce yazdırıyoruz
        console.error("Anonim giriş hatası:", err);
      });
    }

    setIsHydrated(true);
  }, [auth]);

  const handleLogin = (name: string) => {
    localStorage.setItem('kanka_voice_user', name);
    setUserName(name);
  };

  const handleLogout = () => {
    localStorage.removeItem('kanka_voice_user');
    setUserName(null);
  };

  // Prevent hydration mismatch
  if (!isHydrated) return null;

  if (!userName || !userId) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return <MainApp userName={userName} userId={userId} onLogout={handleLogout} />;
}
