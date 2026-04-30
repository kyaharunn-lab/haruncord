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
    console.error('Yerel track eklenirken hata oluştu:', error);
  }
};

/**
 * Bir SDP teklifi (Offer) oluşturur.
 */
export const createOffer = async (pc: RTCPeerConnection): Promise<RTCSessionDescriptionInit | null> => {
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    return offer;
  } catch (error) {
    console.error('Teklif (Offer) oluşturulurken hata oluştu:', error);
    return null;
  }
};

/**
 * Bir SDP yanıtı (Answer) oluşturur.
 */
export const createAnswer = async (pc: RTCPeerConnection, offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit | null> => {
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return answer;
  } catch (error) {
    console.error('Yanıt (Answer) oluşturulurken hata oluştu:', error);
    return null;
  }
};

/**
 * Uzak SDP açıklamasını ayarlar.
 */
export const setRemoteDescription = async (pc: RTCPeerConnection, desc: RTCSessionDescriptionInit) => {
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(desc));
  } catch (error) {
    console.error('Uzak açıklama ayarlanırken hata oluştu:', error);
  }
};

/**
 * ICE adayını PeerConnection'a ekler.
 */
export const addIceCandidate = async (pc: RTCPeerConnection, candidate: RTCIceCandidateInit) => {
  try {
    if (candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  } catch (error) {
    console.error('ICE adayı eklenirken hata oluştu:', error);
  }
};

/**
 * ICE adaylarını toplamak için bir event listener ayarlar.
 */
export const collectIceCandidates = (pc: RTCPeerConnection, onCandidate: (candidate: RTCIceCandidate | null) => void) => {
  pc.onicecandidate = (event) => {
    onCandidate(event.candidate);
  };
};

/**
 * Test amaçlı boş bir teklif oluşturur.
 */
export const createTestOffer = async (): Promise<RTCSessionDescriptionInit | null> => {
  const pc = createPeerConnection();
  if (!pc) return null;
  const offer = await createOffer(pc);
  pc.close();
  return offer;
};

/**
 * Bir PeerConnection bağlantısını kapatır ve kaynakları temizler.
 */
export const closePeerConnection = (pc: RTCPeerConnection | null) => {
  if (!pc) return;
  
  try {
    pc.close();
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    pc.onsignalingstatechange = null;
  } catch (error) {
    console.error('Bağlantı kapatılırken hata oluştu:', error);
  }
};
