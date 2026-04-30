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

export const createPeerConnection = () => {
  console.log('createPeerConnection placeholder');
};

export const createOffer = () => {
  console.log('createOffer placeholder');
};

export const createAnswer = () => {
  console.log('createAnswer placeholder');
};

export const addIceCandidate = () => {
  console.log('addIceCandidate placeholder');
};
