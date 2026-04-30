/**
 * Sinyalleşme işlemleri için geçici placeholder fonksiyonlar.
 * Firestore veya WebRTC bağımlılığı içermez.
 */

/**
 * Yeni bir sinyal oluşturur (Şimdilik sadece log yazar).
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
