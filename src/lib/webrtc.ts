/**
 * WebRTC yardımcı fonksiyonları.
 * Bu dosya sadece temel bağlantı ve medya yönetimi işlemlerini içerir.
 */

/**
 * Kullanıcıdan mikrofon izni isteyerek yerel ses akışını (MediaStream) döndürür.
 */
export const getLocalAudioStream = async (): Promise<MediaStream | null> => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    return stream;
  } catch (error) {
    console.error('Mikrofon erişimi sırasında bir hata oluştu:', error);
    return null;
  }
};

/**
 * Google STUN sunucusu kullanarak yeni bir RTCPeerConnection nesnesi oluşturur.
 */
export const createPeerConnection = (): RTCPeerConnection | null => {
  try {
    const pc = new RTCPeerConnection({
      iceServers: [
        {
          urls: 'stun:stun.l.google.com:19302',
        },
      ],
    });
    return pc;
  } catch (error) {
    console.error('PeerConnection oluşturulurken bir hata oluştu:', error);
    return null;
  }
};

/**
 * Yerel medya akışındaki track'leri belirtilen PeerConnection nesnesine ekler.
 */
export const addLocalTracks = (pc: RTCPeerConnection, stream: MediaStream) => {
  try {
    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });
  } catch (error) {
    console.error('Local track eklenirken hata oluştu:', error);
  }
};

/**
 * Bir PeerConnection bağlantısını kapatır ve kaynakları temizler.
 */
export const closePeerConnection = (pc: RTCPeerConnection | null) => {
  if (!pc) return;
  
  try {
    // Bağlantıyı kapat
    pc.close();
    
    // Event listener'ları temizlemek gerekebilir (bağlantı kurulduğunda eklenecekler)
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    pc.onsignalingstatechange = null;
  } catch (error) {
    console.error('Bağlantı kapatılırken hata oluştu:', error);
  }
};
