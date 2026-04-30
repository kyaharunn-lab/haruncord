import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

/**
 * WebRTC Answer (Yanıt) bilgisini Firestore'a kaydeder.
 * @param db Firestore veritabanı örneği
 * @param channelId Ses kanalı ID'si
 * @param userId Yanıtı gönderen kullanıcı ID'si
 * @param targetUserId Yanıtın gönderildiği (teklifi yapan) kullanıcı ID'si
 * @param answer WebRTC Answer nesnesi (type ve sdp içeren)
 */
export async function saveAnswer(db: any, channelId: string, userId: string, targetUserId: string, answer: any) {
  try {
    const answersRef = collection(db, 'voiceChannels', channelId, 'answers');
    return await addDoc(answersRef, {
      userId,
      targetUserId,
      answer: {
        type: answer.type,
        sdp: answer.sdp
      },
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    console.error('Answer kaydedilirken hata oluştu:', error);
    throw error;
  }
}

/**
 * WebRTC ICE Candidate bilgisini Firestore'a kaydeder.
 * @param db Firestore veritabanı örneği
 * @param channelId Ses kanalı ID'si
 * @param userId Adayı gönderen kullanıcı ID'si
 * @param candidate WebRTC ICE candidate nesnesi
 */
export async function saveIceCandidate(db: any, channelId: string, userId: string, candidate: any) {
  try {
    const candidatesRef = collection(db, 'voiceChannels', channelId, 'candidates');
    return await addDoc(candidatesRef, {
      userId,
      candidate: candidate.toJSON ? candidate.toJSON() : candidate,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    console.error('ICE Candidate kaydedilirken hata oluştu:', error);
    throw error;
  }
}

/**
 * Sinyalleşme işlemleri için geçici placeholder fonksiyonlar.
 */
export async function createSignal(data: any) {
  console.log('Sinyal oluşturuluyor:', data);
}

/**
 * Sinyalleri dinler (Şimdilik boş bir abonelik döndürür).
 */
export function listenSignals(userId: string, callback: (signal: any) => void) {
  console.log('Sinyaller dinleniyor:', userId);
  return () => {
    console.log('Sinyal dinleme durduruldu');
  };
}

/**
 * Kullanıcıya ait sinyalleri siler.
 */
export async function deleteSignalsForUser(userId: string) {
  console.log('Kullanıcı sinyalleri siliniyor:', userId);
}
