import React, { useState, useRef } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { Upload, Loader2, Film, Download, Music, Image as ImageIcon, Play, CheckCircle2, Zap, Sparkles, Layers, Smartphone, ArrowRight, Star, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';

type Scene = {
  startTime: number;
  endTime: number;
  prompt: string;
  imageUrl?: string;
  videoUrl?: string;
};

const ART_STYLES = [
  { id: 'ghibli', name: 'Studio Ghibli', prompt: 'Studio Ghibli anime style, masterpiece, high quality, vibrant colors, detailed background' },
  { id: 'cinematic', name: 'Cinematográfico', prompt: 'Cinematic, photorealistic, 8k resolution, highly detailed, dramatic lighting, unreal engine 5 render' },
  { id: 'cyberpunk', name: 'Cyberpunk', prompt: 'Cyberpunk style, neon lights, futuristic, highly detailed, dark atmosphere, sci-fi' },
  { id: 'watercolor', name: 'Aquarela', prompt: 'Watercolor painting style, soft edges, dreamy, artistic, beautiful brushstrokes' },
  { id: 'pixar', name: 'Animação 3D (Pixar)', prompt: '3D animation style, Pixar style, cute, vibrant colors, soft lighting, highly detailed' },
  { id: 'comic', name: 'Quadrinhos', prompt: 'Comic book style, bold lines, vibrant colors, pop art, dynamic composition' }
];

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>('');
  const [progress, setProgress] = useState<number>(0);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [step, setStep] = useState<number>(0); // 0: upload, 1: analyzing, 2: generating images, 3: animating scenes, 4: rendering, 5: done
  const [selectedStyleId, setSelectedStyleId] = useState<string>('ghibli');
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">("16:9");
  const [useVeo, setUseVeo] = useState<boolean>(true);
  const [showLanding, setShowLanding] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isManualMode, setIsManualMode] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setError(null);

      // Check audio duration
      const audio = new Audio();
      audio.src = URL.createObjectURL(selectedFile);
      audio.onloadedmetadata = () => {
        URL.revokeObjectURL(audio.src);
        if (audio.duration > 50) {
          setError('O áudio deve ter no máximo 50 segundos.');
          setFile(null);
        } else {
          setFile(selectedFile);
          setVideoUrl(null);
          setScenes([]);
          setStep(0);
        }
      };
    }
  };

  const processAudio = async () => {
    if (!file) return;

    // Check for API Key for Veo if enabled
    if (useVeo) {
      const hasKey = await (window as any).aistudio.hasSelectedApiKey();
      if (!hasKey) {
        await (window as any).aistudio.openSelectKey();
      }
    }

    setIsProcessing(true);
    setStep(1);
    setStatus('Analisando o áudio com a IA...');
    setProgress(0);

    try {
      const audioObj = new Audio();
      audioObj.src = URL.createObjectURL(file);
      await new Promise((resolve) => {
        audioObj.onloadedmetadata = resolve;
      });
      const audioDuration = audioObj.duration;
      URL.revokeObjectURL(audioObj.src);

      const aiInstance = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY });
      const base64Audio = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const base64 = result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const selectedStyle = ART_STYLES.find(s => s.id === selectedStyleId) || ART_STYLES[0];

      const response = await aiInstance.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: file.type || 'audio/mp3',
                data: base64Audio
              }
            },
            {
              text: `Analise este áudio e divida-o em cenas sequenciais. Para cada cena, forneça o tempo de início (startTime) e fim (endTime) em segundos, e uma descrição visual detalhada (prompt) do que está acontecendo, adequada para geração de imagens no estilo ${selectedStyle.name} em formato ${aspectRatio === '16:9' ? 'paisagem (horizontal)' : 'retrato (vertical)'}. As cenas devem cobrir toda a duração do áudio de forma contínua. Mantenha as cenas com duração entre 3 a 8 segundos cada para ter uma boa variação visual.`
            }
          ]
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                startTime: { type: Type.NUMBER },
                endTime: { type: Type.NUMBER },
                prompt: { type: Type.STRING }
              },
              required: ["startTime", "endTime", "prompt"]
            }
          }
        }
      });

      let text = response.text;
      if (!text) throw new Error('Falha ao analisar o áudio');
      
      const parsedScenes: Scene[] = JSON.parse(text);
      if (parsedScenes.length > 0) {
        parsedScenes[parsedScenes.length - 1].endTime = audioDuration;
      }
      
      setScenes(parsedScenes);

      if (isManualMode) {
        setStep(2);
        setStatus('Roteiro gerado! Revise as cenas abaixo e clique em "Gerar Imagens".');
        setIsProcessing(false);
        return;
      }

      // Automatic Mode continues...
      await generateImages(parsedScenes);
    } catch (error) {
      console.error(error);
      setStatus('Erro ao processar áudio.');
      setIsProcessing(false);
    }
  };

  const generateImages = async (inputScenes?: Scene[]) => {
    const currentScenes = inputScenes || [...scenes];
    if (currentScenes.length === 0) return;

    setIsProcessing(true);
    setStep(2);
    setStatus('Gerando imagens das cenas...');
    
    const aiInstance = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY });
    const selectedStyle = ART_STYLES.find(s => s.id === selectedStyleId) || ART_STYLES[0];

    for (let i = 0; i < currentScenes.length; i++) {
      const scene = currentScenes[i];
      if (scene.imageUrl) continue;

      setStatus(`Desenhando cena ${i + 1} de ${currentScenes.length}...`);
      setProgress((i / currentScenes.length) * 100);
      
      const prompt = `${selectedStyle.prompt}. ${scene.prompt}`;
      
      let retries = 4;
      let backoffDelay = 2000;
      while (retries > 0 && !scene.imageUrl) {
        try {
          const imgResponse = await aiInstance.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts: [{ text: prompt }] },
            config: { imageConfig: { aspectRatio: aspectRatio } }
          });

          for (const part of imgResponse.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) {
              scene.imageUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
              break;
            }
          }
        } catch (e: any) {
          retries--;
          if (retries > 0) await new Promise(r => setTimeout(r, backoffDelay));
          backoffDelay *= 2;
        }
      }
      setScenes([...currentScenes]);
    }
    
    if (isManualMode) {
      setStatus('Imagens geradas! Clique em "Animar com Veo" ou "Pular para Montagem".');
      setStep(3);
      setIsProcessing(false);
      return;
    }

    if (useVeo) {
      await animateWithVeo(currentScenes);
    } else {
      await renderFinalVideo(currentScenes);
    }
  };

  const animateWithVeo = async (inputScenes?: Scene[]) => {
    const currentScenes = inputScenes || [...scenes];
    setIsProcessing(true);
    setStep(3);
    setStatus('Animando cenas com Veo...');
    
    const aiInstance = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY });

    for (let i = 0; i < currentScenes.length; i++) {
      const scene = currentScenes[i];
      if (!scene.imageUrl || scene.videoUrl) continue;

      setStatus(`Animando cena ${i + 1} de ${currentScenes.length}...`);
      setProgress((i / currentScenes.length) * 100);

      let veoRetries = 3;
      let veoBackoff = 5000;
      while (veoRetries > 0 && !scene.videoUrl) {
        try {
          const base64Img = scene.imageUrl.split(',')[1];
          let operation = await aiInstance.models.generateVideos({
            model: 'veo-3.1-fast-generate-preview',
            prompt: scene.prompt,
            image: { imageBytes: base64Img, mimeType: 'image/png' },
            config: { numberOfVideos: 1, resolution: '720p', aspectRatio: aspectRatio }
          });

          while (!operation.done) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            operation = await aiInstance.operations.getVideosOperation({ operation: operation });
          }

          const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
          if (downloadLink) {
            const videoRes = await fetch(downloadLink, {
              method: 'GET',
              headers: { 'x-goog-api-key': process.env.API_KEY || '' },
            });
            const videoBlob = await videoRes.blob();
            scene.videoUrl = URL.createObjectURL(videoBlob);
          }
        } catch (e: any) {
          veoRetries--;
          if (veoRetries > 0) await new Promise(resolve => setTimeout(resolve, veoBackoff));
          veoBackoff *= 2;
        }
      }
      setScenes([...currentScenes]);
    }

    if (isManualMode) {
      setStatus('Animações prontas! Clique em "Montar Vídeo Final".');
      setStep(4);
      setIsProcessing(false);
      return;
    }

    await renderFinalVideo(currentScenes);
  };

  const renderFinalVideo = async (inputScenes?: Scene[]) => {
    const currentScenes = inputScenes || [...scenes];
    if (!file) return;

    setIsProcessing(true);
    setStep(4);
    setStatus('Montando o vídeo final localmente...');
    setProgress(0);

    try {
      const ffmpeg = new FFmpeg();
      ffmpeg.on('progress', ({ progress }) => setProgress(progress * 100));
      await ffmpeg.load({ coreURL, wasmURL });

      const audioData = await fetchFile(file);
      await ffmpeg.writeFile('audio.mp3', audioData);

      let concatText = '';
      for (let i = 0; i < currentScenes.length; i++) {
        const scene = currentScenes[i];
        const duration = scene.endTime - scene.startTime;
        
        if (scene.videoUrl && useVeo) {
          const videoName = `vid${i}.mp4`;
          const res = await fetch(scene.videoUrl);
          const blob = await res.blob();
          const vidData = await fetchFile(blob);
          await ffmpeg.writeFile(videoName, vidData);
          
          const processedVidName = `proc_vid${i}.mp4`;
          await ffmpeg.exec([
            '-stream_loop', '-1', '-i', videoName, '-t', duration.toFixed(3),
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
            '-vf', `scale=${aspectRatio === '16:9' ? '1280:720' : '720:1280'},setsar=1`,
            processedVidName
          ]);
          concatText += `file '${processedVidName}'\n`;
        } else if (scene.imageUrl) {
          const imgName = `img${i}.png`;
          const res = await fetch(scene.imageUrl);
          const blob = await res.blob();
          const imgData = await fetchFile(blob);
          await ffmpeg.writeFile(imgName, imgData);
          
          const clipName = `clip${i}.mp4`;
          await ffmpeg.exec([
            '-loop', '1', '-i', imgName, '-t', duration.toFixed(3),
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
            '-vf', `scale=${aspectRatio === '16:9' ? '1280:720' : '720:1280'},setsar=1`,
            clipName
          ]);
          concatText += `file '${clipName}'\n`;
        } else {
          const blackClipName = `black${i}.mp4`;
          await ffmpeg.exec([
            '-f', 'lavfi', '-i', `color=c=black:s=${aspectRatio === '16:9' ? '1280x720' : '720x1280'}:d=${duration.toFixed(3)}`,
            '-c:v', 'libx264', '-pix_fmt', 'yuv420p', blackClipName
          ]);
          concatText += `file '${blackClipName}'\n`;
        }
      }

      await ffmpeg.writeFile('concat.txt', concatText);
      await ffmpeg.exec([
        '-f', 'concat', '-safe', '0', '-i', 'concat.txt', '-i', 'audio.mp3',
        '-c:v', 'copy', '-c:a', 'aac', 'output.mp4'
      ]);

      const data = await ffmpeg.readFile('output.mp4');
      const finalVideoBlob = new Blob([(data as Uint8Array).buffer], { type: 'video/mp4' });
      setVideoUrl(URL.createObjectURL(finalVideoBlob));
      setStep(5);
      setStatus('Vídeo concluído!');
    } catch (error) {
      console.error(error);
      setStatus('Erro na renderização local.');
    } finally {
      setIsProcessing(false);
    }
  };

  if (showLanding) {
    return (
      <div className="min-h-screen bg-[#f5f5f0] text-[#2c3e50] font-sans selection:bg-[#5A5A40] selection:text-white overflow-x-hidden">
        {/* Hero Section */}
        <section className="relative pt-20 pb-32 px-6 overflow-hidden">
          <div className="max-w-6xl mx-auto relative z-10">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center mb-16"
            >
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-white rounded-full shadow-sm mb-8 border border-[#5A5A40]/10">
                <Sparkles className="w-4 h-4 text-[#5A5A40]" />
                <span className="text-xs font-medium uppercase tracking-wider text-[#5A5A40]">A nova era da criação de conteúdo</span>
              </div>
              <h1 className="text-5xl md:text-7xl font-serif font-medium text-[#1a1a1a] mb-8 leading-tight">
                Transforme seu áudio em <br />
                <span className="text-[#5A5A40] italic">Animações Virais</span>
              </h1>
              <p className="text-xl text-[#5A5A40]/70 max-w-2xl mx-auto mb-12">
                A ferramenta ideal para criar Animações, Reels, TikTok e Shorts. 
                Dê vida a suas narrações e áudio MP3 com animações incríveis.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <button
                  onClick={() => setShowLanding(false)}
                  className="px-8 py-4 bg-[#5A5A40] text-white rounded-full font-medium text-lg hover:bg-[#4a4a35] transition-all shadow-xl shadow-[#5A5A40]/20 flex items-center gap-2 group"
                >
                  Começar a Criar Agora
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </motion.div>

            {/* Hero Visual Removed */}
          </div>
          
          {/* Background Decoration */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full -z-10 opacity-30">
            <div className="absolute top-0 left-0 w-96 h-96 bg-[#5A5A40]/10 rounded-full blur-3xl" />
            <div className="absolute bottom-0 right-0 w-96 h-96 bg-[#5A5A40]/10 rounded-full blur-3xl" />
          </div>
        </section>

        {/* Features for Creators */}
        <section className="py-24 px-6 bg-white">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-serif font-medium text-[#1a1a1a] mb-4">Feito para quem cria</h2>
              <p className="text-[#5A5A40]/60">Tudo o que você precisa para dominar os algoritmos.</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {[
                {
                  icon: Smartphone,
                  title: "Foco em Vertical",
                  desc: "Crie vídeos nativos em 9:16 para TikTok e Reels sem esforço."
                },
                {
                  icon: Zap,
                  title: "Velocidade IA",
                  desc: "De áudio bruto (até 50s) para animação completa em menos de 2 minutos."
                },
                {
                  icon: Layers,
                  title: "Múltiplos Estilos",
                  desc: "Ghibli, Pixar, Cyberpunk e mais. Adapte-se a qualquer nicho."
                }
              ].map((feature, i) => (
                <div key={i} className="p-8 rounded-3xl bg-[#f5f5f0]/50 border border-[#5A5A40]/5 hover:border-[#5A5A40]/20 transition-all group">
                  <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-sm mb-6 group-hover:scale-110 transition-transform">
                    <feature.icon className="w-7 h-7 text-[#5A5A40]" />
                  </div>
                  <h3 className="text-xl font-medium text-[#1a1a1a] mb-3">{feature.title}</h3>
                  <p className="text-[#5A5A40]/70 leading-relaxed">{feature.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Examples Gallery Removed */}

        {/* CTA Section */}
        <section className="py-24 px-6">
          <div className="max-w-4xl mx-auto bg-[#5A5A40] rounded-[48px] p-12 md:p-20 text-center text-white relative overflow-hidden">
            <div className="relative z-10">
              <h2 className="text-4xl md:text-5xl font-serif font-medium mb-8">Pronto para viralizar?</h2>
              <p className="text-white/80 text-lg mb-12 max-w-xl mx-auto">
                Junte-se a centenas de criadores que já estão usando o AI Audio Animator para elevar o nível de suas produções.
              </p>
              <button
                onClick={() => setShowLanding(false)}
                className="px-10 py-5 bg-white text-[#5A5A40] rounded-full font-medium text-xl hover:bg-[#f5f5f0] transition-all shadow-2xl flex items-center gap-3 mx-auto"
              >
                Criar minha primeira animação
                <ArrowRight className="w-6 h-6" />
              </button>
            </div>
            
            {/* Decoration */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2 blur-3xl" />
          </div>
        </section>

        {/* Footer */}
        <footer className="py-12 px-6 border-t border-[#5A5A40]/10">
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-[#5A5A40] rounded-lg">
                <Film className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-serif font-medium text-[#1a1a1a]">AI Audio Animator</span>
            </div>
            <p className="text-[#5A5A40]/40 text-sm">© 2026 AI Audio Animator. Criado para a nova geração de criadores.</p>
            <div className="flex items-center gap-6">
              <a href="#" className="text-[#5A5A40]/60 hover:text-[#5A5A40] transition-colors">Termos</a>
              <a href="#" className="text-[#5A5A40]/60 hover:text-[#5A5A40] transition-colors">Privacidade</a>
            </div>
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f0] text-[#2c3e50] font-sans selection:bg-[#5A5A40] selection:text-white">
      <div className="max-w-4xl mx-auto px-6 py-12">
        
        <header className="mb-12 text-center relative">
          <button 
            onClick={() => setShowLanding(true)}
            className="absolute left-0 top-0 p-2 text-[#5A5A40]/60 hover:text-[#5A5A40] transition-colors"
            title="Voltar para a Landing Page"
          >
            <ChevronRight className="w-6 h-6 rotate-180" />
          </button>
          <motion.div 
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center justify-center p-4 bg-white rounded-full shadow-sm mb-6"
          >
            <Film className="w-8 h-8 text-[#5A5A40]" />
          </motion.div>
          <motion.h1 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="text-4xl md:text-5xl font-serif font-medium text-[#1a1a1a] mb-4"
          >
            AI Audio Animator
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="text-lg text-[#5A5A40]/80 max-w-xl mx-auto"
          >
            Transforme seu áudio em uma animação incrível.
            Faça o upload de um MP3, escolha um estilo visual e a IA fará o resto.
          </motion.p>
        </header>

        <main className="space-y-8">
          
          {/* Upload Section */}
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white p-8 rounded-[32px] shadow-[0_4px_20px_rgba(0,0,0,0.05)]"
          >
            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-100 text-red-600 text-sm rounded-2xl w-full text-center">
                {error}
              </div>
            )}
            {!file ? (
              <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-[#5A5A40]/20 rounded-2xl cursor-pointer hover:bg-[#f5f5f0]/50 transition-colors">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-12 h-12 text-[#5A5A40]/40 mb-4" />
                  <p className="mb-2 text-lg text-[#5A5A40] font-medium">Clique para enviar seu áudio</p>
                  <p className="text-sm text-[#5A5A40]/60">MP3, WAV (Máx. 50 segundos)</p>
                </div>
                <input type="file" className="hidden" accept="audio/*" onChange={handleFileChange} />
              </label>
            ) : (
              <div className="flex flex-col items-center">
                <div className="flex items-center gap-4 p-4 bg-[#f5f5f0] rounded-2xl w-full mb-6">
                  <div className="p-3 bg-white rounded-xl">
                    <Music className="w-6 h-6 text-[#5A5A40]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#1a1a1a] truncate">{file.name}</p>
                    <p className="text-xs text-[#5A5A40]/60">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  </div>
                  {!isProcessing && step === 0 && (
                    <button 
                      onClick={() => setFile(null)}
                      className="text-xs text-red-500 hover:underline px-2"
                    >
                      Remover
                    </button>
                  )}
                </div>

                {!isProcessing && step === 0 && (
                  <div className="w-full flex flex-col items-center gap-6">
                    <div className="w-full max-w-md">
                      <label className="block text-sm font-medium text-[#1a1a1a] mb-2 text-center">
                        Formato do Vídeo
                      </label>
                      <div className="grid grid-cols-2 gap-2 mb-6">
                        <button
                          onClick={() => setAspectRatio("16:9")}
                          className={`px-4 py-3 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                            aspectRatio === "16:9"
                              ? 'bg-[#5A5A40] text-white shadow-md'
                              : 'bg-[#f5f5f0] text-[#5A5A40] hover:bg-[#e8e8e0]'
                          }`}
                        >
                          <div className="w-4 h-3 border-2 border-current rounded-sm opacity-80" />
                          16:9 (Horizontal)
                        </button>
                        <button
                          onClick={() => setAspectRatio("9:16")}
                          className={`px-4 py-3 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                            aspectRatio === "9:16"
                              ? 'bg-[#5A5A40] text-white shadow-md'
                              : 'bg-[#f5f5f0] text-[#5A5A40] hover:bg-[#e8e8e0]'
                          }`}
                        >
                          <div className="w-3 h-4 border-2 border-current rounded-sm opacity-80" />
                          9:16 (Vertical)
                        </button>
                      </div>

                      <label className="block text-sm font-medium text-[#1a1a1a] mb-2 text-center">
                        Estilo Visual
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {ART_STYLES.map((style) => (
                          <button
                            key={style.id}
                            onClick={() => setSelectedStyleId(style.id)}
                            className={`px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                              selectedStyleId === style.id
                                ? 'bg-[#5A5A40] text-white shadow-md'
                                : 'bg-[#f5f5f0] text-[#5A5A40] hover:bg-[#e8e8e0]'
                            }`}
                          >
                            {style.name}
                          </button>
                        ))}
                      </div>

                      <label className="block text-sm font-medium text-[#1a1a1a] mt-6 mb-2 text-center">
                        Tipo de Resultado
                      </label>
                      <div className="grid grid-cols-2 gap-2 mb-6">
                        <button
                          onClick={() => setUseVeo(false)}
                          className={`px-4 py-3 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                            !useVeo
                              ? 'bg-[#5A5A40] text-white shadow-md'
                              : 'bg-[#f5f5f0] text-[#5A5A40] hover:bg-[#e8e8e0]'
                          }`}
                        >
                          <ImageIcon className="w-4 h-4" />
                          Imagens Estáticas
                        </button>
                        <button
                          onClick={() => setUseVeo(true)}
                          className={`px-4 py-3 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                            useVeo
                              ? 'bg-[#5A5A40] text-white shadow-md'
                              : 'bg-[#f5f5f0] text-[#5A5A40] hover:bg-[#e8e8e0]'
                          }`}
                        >
                          <Zap className="w-4 h-4" />
                          Animado (Veo 3)
                        </button>
                      </div>

                      <div className="flex items-center justify-center gap-3 p-4 bg-[#f5f5f0] rounded-2xl mb-6">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-[#1a1a1a]">Modo Manual</p>
                          <p className="text-xs text-[#5A5A40]/60">Revise o roteiro e gere cada etapa manualmente.</p>
                        </div>
                        <button
                          onClick={() => setIsManualMode(!isManualMode)}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                            isManualMode ? 'bg-[#5A5A40]' : 'bg-gray-300'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                              isManualMode ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>
                    </div>

                    <button
                      onClick={processAudio}
                      className="w-full sm:w-auto px-8 py-4 bg-[#5A5A40] text-white rounded-full font-medium text-lg hover:bg-[#4a4a35] transition-colors shadow-lg shadow-[#5A5A40]/20 flex items-center justify-center gap-2"
                    >
                      <Play className="w-5 h-5 fill-current" />
                      {isManualMode ? 'Gerar Roteiro' : 'Iniciar Animação'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </motion.div>

          {/* Manual Mode Controls */}
          {isManualMode && scenes.length > 0 && !isProcessing && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white p-8 rounded-[32px] shadow-[0_4px_20px_rgba(0,0,0,0.05)]"
            >
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-serif font-medium text-[#1a1a1a]">Controle Manual</h3>
                <div className="flex gap-2">
                  {step === 1 && (
                    <button
                      onClick={() => generateImages(scenes)}
                      className="px-4 py-2 bg-[#5A5A40] text-white rounded-xl text-sm font-medium hover:bg-[#4a4a35] transition-colors flex items-center gap-2"
                    >
                      <ImageIcon className="w-4 h-4" />
                      Gerar Imagens
                    </button>
                  )}
                  {step === 2 && useVeo && (
                    <button
                      onClick={() => animateWithVeo(scenes)}
                      className="px-4 py-2 bg-[#5A5A40] text-white rounded-xl text-sm font-medium hover:bg-[#4a4a35] transition-colors flex items-center gap-2"
                    >
                      <Zap className="w-4 h-4" />
                      Animar com Veo
                    </button>
                  )}
                  {(step === 2 && !useVeo) || (step === 3) ? (
                    <button
                      onClick={() => renderFinalVideo(scenes)}
                      className="px-4 py-2 bg-[#5A5A40] text-white rounded-xl text-sm font-medium hover:bg-[#4a4a35] transition-colors flex items-center gap-2"
                    >
                      <Film className="w-4 h-4" />
                      Renderizar Vídeo Final
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="space-y-4">
                {scenes.map((scene, idx) => (
                  <div key={idx} className="p-4 bg-[#f5f5f0] rounded-2xl border border-[#5A5A40]/10">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center flex-shrink-0 font-mono text-[#5A5A40] font-bold">
                        {idx + 1}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-mono text-[#5A5A40]/60">
                            {scene.startTime.toFixed(1)}s - {scene.endTime.toFixed(1)}s
                          </span>
                        </div>
                        <textarea
                          value={scene.prompt}
                          onChange={(e) => {
                            const newScenes = [...scenes];
                            newScenes[idx].prompt = e.target.value;
                            setScenes(newScenes);
                          }}
                          disabled={step > 1}
                          className="w-full bg-white border border-[#5A5A40]/10 rounded-xl p-3 text-sm text-[#1a1a1a] focus:outline-none focus:ring-2 focus:ring-[#5A5A40]/20 resize-none"
                          rows={2}
                        />
                      </div>
                      <div className="flex flex-col gap-2">
                        {scene.imageUrl && (
                          <div className="w-20 h-20 rounded-lg overflow-hidden border border-white shadow-sm">
                            <img src={scene.imageUrl} className="w-full h-full object-cover" />
                          </div>
                        )}
                        {scene.videoUrl && (
                          <div className="w-20 h-20 rounded-lg overflow-hidden border border-white shadow-sm">
                            <video src={scene.videoUrl} className="w-full h-full object-cover" muted loop autoPlay />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Progress Section */}
          <AnimatePresence>
            {isProcessing && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="bg-white p-8 rounded-[32px] shadow-[0_4px_20px_rgba(0,0,0,0.05)] overflow-hidden"
              >
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-medium text-[#1a1a1a] flex items-center gap-3">
                    <Loader2 className="w-5 h-5 animate-spin text-[#5A5A40]" />
                    {status}
                  </h3>
                  <span className="text-sm font-mono text-[#5A5A40]">{Math.round(progress)}%</span>
                </div>
                
                <div className="w-full bg-[#f5f5f0] rounded-full h-2 mb-8 overflow-hidden">
                  <div 
                    className="bg-[#5A5A40] h-2 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${progress}%` }}
                  ></div>
                </div>

                <div className={`grid grid-cols-1 ${useVeo ? 'sm:grid-cols-4' : 'sm:grid-cols-3'} gap-4`}>
                  {[
                    { s: 1, label: 'Análise', icon: Music },
                    { s: 2, label: 'Arte', icon: ImageIcon },
                    ...(useVeo ? [{ s: 3, label: 'Animação', icon: Zap }] : []),
                    { s: 4, label: 'Finalização', icon: Film },
                  ].map((item) => (
                    <div 
                      key={item.s}
                      className={`p-4 rounded-2xl border ${
                        step > item.s 
                          ? 'border-green-200 bg-green-50' 
                          : step === item.s 
                            ? 'border-[#5A5A40]/20 bg-[#f5f5f0]' 
                            : 'border-transparent opacity-50'
                      } flex items-center gap-3 transition-colors`}
                    >
                      {step > item.s ? (
                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                      ) : (
                        <item.icon className={`w-5 h-5 ${step === item.s ? 'text-[#5A5A40]' : 'text-[#5A5A40]/40'}`} />
                      )}
                      <span className={`text-sm font-medium ${step >= item.s ? 'text-[#1a1a1a]' : 'text-[#5A5A40]/60'}`}>
                        {item.label}
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Results Section */}
          <AnimatePresence>
            {videoUrl && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white p-8 rounded-[32px] shadow-[0_4px_20px_rgba(0,0,0,0.05)]"
              >
                <h2 className="text-2xl font-serif font-medium text-[#1a1a1a] mb-6 text-center">Sua Animação</h2>
                
                <div className={`${aspectRatio === '16:9' ? 'aspect-video' : 'aspect-[9/16] max-w-sm mx-auto'} bg-black rounded-2xl overflow-hidden mb-8 shadow-inner`}>
                  <video 
                    src={videoUrl} 
                    controls 
                    className="w-full h-full object-contain"
                    autoPlay
                  />
                </div>

                <div className="flex justify-center">
                  <button 
                    onClick={() => {
                      const a = document.createElement('a');
                      a.href = videoUrl;
                      a.download = 'ghibli-animation.mp4';
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    }}
                    className="px-8 py-4 bg-[#5A5A40] text-white rounded-full font-medium text-lg hover:bg-[#4a4a35] transition-colors shadow-lg shadow-[#5A5A40]/20 flex items-center gap-2 cursor-pointer"
                  >
                    <Download className="w-5 h-5" />
                    Baixar MP4
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Scenes Preview */}
          {scenes.length > 0 && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="pt-8"
            >
              <h3 className="text-xl font-serif font-medium text-[#1a1a1a] mb-6 px-4">Storyboard</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {scenes.map((scene, idx) => (
                  <div key={idx} className="bg-white rounded-2xl overflow-hidden shadow-sm border border-[#5A5A40]/5">
                    <div className={`${aspectRatio === '16:9' ? 'aspect-video' : 'aspect-[9/16]'} bg-[#f5f5f0] relative`}>
                      {scene.videoUrl ? (
                        <video src={scene.videoUrl} className="w-full h-full object-cover" autoPlay muted loop />
                      ) : scene.imageUrl ? (
                        <img src={scene.imageUrl} alt={`Scene ${idx + 1}`} className="w-full h-full object-cover" />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <ImageIcon className="w-8 h-8 text-[#5A5A40]/20" />
                        </div>
                      )}
                      <div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-md text-white text-[10px] font-mono px-2 py-1 rounded-md">
                        {scene.startTime.toFixed(1)}s - {scene.endTime.toFixed(1)}s
                      </div>
                    </div>
                    <div className="p-3">
                      <p className="text-xs text-[#5A5A40] line-clamp-3" title={scene.prompt}>
                        {scene.prompt}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

        </main>
      </div>
    </div>
  );
}
