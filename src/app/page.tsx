
"use client"

import { useState, useEffect } from 'react';
import { LoginScreen } from '@/components/LoginScreen';
import { MainApp } from '@/components/MainApp';
import { useAuth } from '@/firebase';
import { signInAnonymously } from 'firebase/auth';

export type UserRole = 'admin' | 'mod' | 'member';

export default function Home() {
  const [userName, setUserName] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<UserRole>('member');
  const [isHydrated, setIsHydrated] = useState(false);
  const auth = useAuth();

  useEffect(() => {
    const storedName = localStorage.getItem('kanka_voice_user');
    const storedRole = localStorage.getItem('kanka_voice_role') as UserRole;
    let storedId = localStorage.getItem('kanka_voice_user_id');
    
    if (storedName) {
      setUserName(storedName);
    }
    
    if (storedRole) {
      setUserRole(storedRole);
    }
    
    if (!storedId) {
      storedId = Math.random().toString(36).substring(2, 15);
      localStorage.setItem('kanka_voice_user_id', storedId);
    }
    setUserId(storedId);

    if (auth) {
      signInAnonymously(auth).catch((err) => {
        console.error("Anonim giriş hatası:", err);
      });
    }

    setIsHydrated(true);
  }, [auth]);

  const handleLogin = (name: string, role: UserRole) => {
    localStorage.setItem('kanka_voice_user', name);
    localStorage.setItem('kanka_voice_role', role);
    setUserName(name);
    setUserRole(role);
  };

  const handleLogout = () => {
    localStorage.removeItem('kanka_voice_user');
    localStorage.removeItem('kanka_voice_role');
    setUserName(null);
    setUserRole('member');
  };

  if (!isHydrated) return null;

  if (!userName || !userId) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <MainApp 
      userName={userName} 
      userId={userId} 
      userRole={userRole} 
      onLogout={handleLogout} 
    />
  );
}
