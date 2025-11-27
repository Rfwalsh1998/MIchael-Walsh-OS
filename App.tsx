/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/* tslint:disable */
import {GoogleGenAI, Modality} from '@google/genai';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {GeneratedContent} from './GeneratedContent';
import {Icon} from './Icon';
import {Window} from './Window';
import {APP_DEFINITIONS_CONFIG, MAX_HISTORY_LENGTH} from './constants';
import {
  createPcmBlob,
  decode,
  decodeAudioData,
  generateAppIcon,
  generateImageWithGemini,
  generateVideoWithVeo,
  streamAppContent,
} from './geminiService';
import {AppDefinition, InteractionData} from './types';

const DesktopView: React.FC<{
  apps: AppDefinition[];
  onAppOpen: (app: AppDefinition) => void;
}> = ({apps, onAppOpen}) => (
  <div className="flex flex-wrap content-start p-4">
    {apps.map((app) => (
      <Icon key={app.id} app={app} onInteract={() => onAppOpen(app)} />
    ))}
  </div>
);

const App: React.FC = () => {
  const [activeApp, setActiveApp] = useState<AppDefinition | null>(null);
  const [llmContent, setLlmContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [interactionHistory, setInteractionHistory] = useState<
    InteractionData[]
  >([]);

  // App definitions are now in state to allow for dynamic additions.
  const [appDefinitions, setAppDefinitions] = useState<AppDefinition[]>(
    APP_DEFINITIONS_CONFIG,
  );

  const [appContentCache, setAppContentCache] = useState<
    Record<string, string>
  >({});
  const [currentAppPath, setCurrentAppPath] = useState<string[]>([]); // For UI graph statefulness

  // --- AI Studio Refs & State ---
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const liveSessionRef = useRef<any>(null);
  let nextStartTime = 0; // Cursor for audio playback

  const handleCloseAppView = useCallback(() => {
    // Cleanup Live Session if active
    if (liveSessionRef.current) {
      try {
        // There is no generic close() on the session object in the current library version in some contexts,
        // but usually dropping the reference and closing audio contexts is enough.
        // However, if we can send a message or close the connection, we should.
        // Assuming the session object has a close method or we just stop sending.
      } catch (e) {
        console.warn('Error closing live session', e);
      }
      liveSessionRef.current = null;
    }
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
    }

    setActiveApp(null);
    setLlmContent('');
    setError(null);
    setInteractionHistory([]);
    setCurrentAppPath([]);
    setIsLoading(false); // Ensure loading is reset
  }, []);

  const internalHandleLlmRequest = useCallback(
    async (
      historyForLlm: InteractionData[],
      maxHistoryLength: number,
      previousContent: string | null,
    ) => {
      if (historyForLlm.length === 0) {
        setError('No interaction data to process.');
        return;
      }

      setIsLoading(true);
      setError(null);

      let accumulatedContent = '';
      // setLlmContent is handled by the caller before this function is invoked.
      try {
        const stream = streamAppContent(
          historyForLlm,
          maxHistoryLength,
          previousContent,
        );
        for await (const chunk of stream) {
          accumulatedContent += chunk;
          setLlmContent((prev) => prev + chunk);
        }
      } catch (e: any) {
        setError('Failed to stream content from the API.');
        console.error(e);
        accumulatedContent = `<div class="p-4 text-red-600 bg-red-100 rounded-md">Error loading content.</div>`;
        setLlmContent(accumulatedContent);
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  // Effect to cache content when loading finishes.
  useEffect(() => {
    // Do not cache anything for the task_handoff_app to ensure it's always stateless
    if (activeApp?.id === 'task_handoff_app') {
      return;
    }

    if (!isLoading && currentAppPath.length > 0 && llmContent) {
      const cacheKey = currentAppPath.join('__');
      // Update cache if content is different or not yet cached for this path
      if (appContentCache[cacheKey] !== llmContent) {
        setAppContentCache((prevCache) => ({
          ...prevCache,
          [cacheKey]: llmContent,
        }));
      }
    }
  }, [llmContent, isLoading, currentAppPath, appContentCache, activeApp]);

  const handleInteraction = useCallback(
    async (interactionData: InteractionData) => {
      // --- AI Studio: Imagen (Image Generation) ---
      if (interactionData.id === 'generate_imagen_action' && interactionData.value) {
        try {
          const {prompt, aspectRatio} = JSON.parse(interactionData.value);
          setIsLoading(true);
          // Show loading UI immediately
          setLlmContent((prev) => 
            prev + `<div class="llm-container mt-4 p-4 bg-gray-100 rounded-lg animate-pulse"><p class="llm-text">Generating image with Gemini...</p></div>`
          );
          
          const imageUrl = await generateImageWithGemini(prompt, aspectRatio);
          
          // Append image to current content
          setLlmContent((prev) => 
            prev.replace(/<div class="llm-container mt-4 p-4 bg-gray-100 rounded-lg animate-pulse">.*?<\/div>/, '') + 
            `<div class="llm-container mt-4"><h3 class="llm-title">Generated Image</h3><img src="${imageUrl}" class="w-full rounded-lg shadow-md" alt="Generated with Gemini"></div>`
          );
        } catch (e) {
          console.error(e);
          alert('Failed to generate image.');
        } finally {
          setIsLoading(false);
        }
        return;
      }

      // --- AI Studio: Veo (Video Generation) ---
      if (interactionData.id === 'generate_veo_action' && interactionData.value) {
        try {
          // Check for API Key selection as per Veo requirements
          if ((window as any).aistudio && typeof (window as any).aistudio.hasSelectedApiKey === 'function') {
             const hasKey = await (window as any).aistudio.hasSelectedApiKey();
             if (!hasKey) {
                await (window as any).aistudio.openSelectKey();
             }
          }

          const {prompt, aspectRatio} = JSON.parse(interactionData.value);
          setIsLoading(true);
          setLlmContent((prev) => 
             prev + `<div class="llm-container mt-4 p-4 bg-gray-100 rounded-lg"><div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500 mb-2"></div><p class="llm-text">Generating video with Veo (this may take a moment)...</p></div>`
          );

          const videoUrl = await generateVideoWithVeo(prompt, aspectRatio);

          setLlmContent((prev) => 
             prev.replace(/<div class="llm-container mt-4 p-4 bg-gray-100 rounded-lg">.*?<\/div>/, '') +
             `<div class="llm-container mt-4"><h3 class="llm-title">Generated Video</h3><video controls autoplay loop src="${videoUrl}" class="w-full rounded-lg shadow-md"></video></div>`
          );

        } catch (e) {
          console.error(e);
          alert('Failed to generate video. Ensure you have selected a valid API key if prompted.');
          // Remove loading indicator on error
          setLlmContent(prev => prev.replace(/<div class="llm-container mt-4 p-4 bg-gray-100 rounded-lg">.*?<\/div>/, ''));
        } finally {
          setIsLoading(false);
        }
        return;
      }

      // --- AI Studio: Live API (Start Session) ---
      if (interactionData.id === 'start-live-session') {
        setIsLoading(true);
        setLlmContent(
          '<div class="flex flex-col items-center justify-center h-[400px] gap-8"><div class="w-32 h-32 bg-blue-500 rounded-full animate-pulse flex items-center justify-center shadow-xl shadow-blue-500/50"><span class="text-4xl">🎙️</span></div><h3 class="llm-title text-2xl">Listening...</h3><p class="llm-text text-gray-500">Speak now. The AI is listening.</p><button class="llm-button bg-red-500 hover:bg-red-600 mt-8" data-interaction-id="stop-live-session">Stop Session</button></div>'
        );

        try {
           const ai = new GoogleGenAI({apiKey: process.env.API_KEY!});
           // Initialize Audio Contexts
           inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 16000});
           outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({sampleRate: 24000});
           
           const sessionPromise = ai.live.connect({
             model: 'gemini-2.5-flash-native-audio-preview-09-2025',
             callbacks: {
               onopen: async () => {
                 console.log('Live session connected');
                 const stream = await navigator.mediaDevices.getUserMedia({audio: true});
                 const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
                 const processor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
                 
                 processor.onaudioprocess = (event) => {
                    const inputData = event.inputBuffer.getChannelData(0);
                    const pcmBlob = createPcmBlob(inputData);
                    sessionPromise.then((session) => session.sendRealtimeInput({media: pcmBlob}));
                 };

                 source.connect(processor);
                 processor.connect(inputAudioContextRef.current!.destination);
               },
               onmessage: async (message) => {
                 const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                 if (audioData && outputAudioContextRef.current) {
                    const audioBuffer = await decodeAudioData(
                      decode(audioData),
                      outputAudioContextRef.current,
                      24000,
                      1
                    );
                    const source = outputAudioContextRef.current.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(outputAudioContextRef.current.destination);
                    source.start(nextStartTime);
                    nextStartTime = Math.max(outputAudioContextRef.current.currentTime, nextStartTime) + audioBuffer.duration;
                 }
               },
               onclose: () => {
                 console.log('Live session closed');
               },
               onerror: (err) => {
                 console.error('Live session error', err);
               }
             },
             config: {
               responseModalities: [Modality.AUDIO],
               speechConfig: {
                 voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Zephyr'}},
               },
             },
           });
           liveSessionRef.current = sessionPromise;
        } catch (err) {
           console.error("Failed to start live session", err);
           setError("Failed to start audio session. Please check microphone permissions.");
        } finally {
           setIsLoading(false);
        }
        return;
      }

      // --- AI Studio: Live API (Stop Session) ---
      if (interactionData.id === 'stop-live-session') {
        if (inputAudioContextRef.current) {
           inputAudioContextRef.current.close();
           inputAudioContextRef.current = null;
        }
        if (outputAudioContextRef.current) {
           outputAudioContextRef.current.close();
           outputAudioContextRef.current = null;
        }
        liveSessionRef.current = null;
        
        // Return to Hub view via LLM generation logic, simulating a "back" navigation or just reset
        // For simplicity, we just render the Hub logic via the standard LLM flow by pretending we clicked "open-ai-voice" again or just resetting.
        // Let's just trigger a standard update to show we stopped.
        setLlmContent('<div class="p-8 text-center"><h3 class="llm-title">Session Ended</h3><p class="llm-text">The voice session has been terminated.</p><button class="llm-button mt-4" data-interaction-id="open-ai-voice">Start New Session</button></div>');
        return;
      }

      // --- Standard App Logic ---

      // Special case for installing a new application
      if (
        interactionData.id === 'install_new_app_action' &&
        interactionData.value
      ) {
        try {
          const {appName, appDescription} = JSON.parse(interactionData.value);

          if (appName) {
            // Show loading spinner in place of the form
            setLlmContent('');
            setError(null);
            setIsLoading(true);
            try {
              const appIcon = await generateAppIcon(
                appName,
                appDescription || '',
              );

              const newApp: AppDefinition = {
                id: `custom_${appName.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`,
                name: appName,
                icon: appIcon,
                description: appDescription || '',
                color: '#e0e0e0', // A neutral default color
              };

              setAppDefinitions((prevApps) => [...prevApps, newApp]);
            } catch (e) {
              console.error('Failed to install app:', e);
              alert(
                'Failed to generate an icon for the new app. Please try again.',
              );
            } finally {
              // Always go back to desktop, on success or failure
              handleCloseAppView();
            }
          } else {
            alert('Please provide a name for the new app.');
          }
        } catch (e) {
          console.error('Failed to parse app installation data:', e);
          alert('There was an error processing the installation request.');
        }
        return; // Stop further processing for this special action
      }

      if (interactionData.id === 'app_close_button') {
        handleCloseAppView();
        return;
      }

      // Capture the content of the screen *before* this interaction
      const previousContent = llmContent;

      const newHistory = [
        interactionData,
        ...interactionHistory.slice(0, MAX_HISTORY_LENGTH - 1),
      ];
      setInteractionHistory(newHistory);

      const newPath = activeApp
        ? [...currentAppPath, interactionData.id]
        : [interactionData.id];
      setCurrentAppPath(newPath);
      const cacheKey = newPath.join('__');

      setLlmContent('');
      setError(null);

      // Use cache if available, except for the stateless Task Handoff app.
      if (appContentCache[cacheKey] && activeApp?.id !== 'task_handoff_app') {
        setLlmContent(appContentCache[cacheKey]);
        setIsLoading(false);
      } else {
        internalHandleLlmRequest(
          newHistory,
          MAX_HISTORY_LENGTH,
          previousContent,
        );
      }
    },
    [
      llmContent,
      interactionHistory,
      internalHandleLlmRequest,
      activeApp,
      currentAppPath,
      appContentCache,
      handleCloseAppView,
    ],
  );

  const handleAppOpen = (app: AppDefinition) => {
    const initialInteraction: InteractionData = {
      id: app.id,
      type: 'app_open',
      elementText: app.name,
      elementType: 'icon',
      appContext: app.id,
    };

    const newHistory = [initialInteraction];
    setInteractionHistory(newHistory);

    const appPath = [app.id];
    setCurrentAppPath(appPath);
    const cacheKey = appPath.join('__');

    setActiveApp(app);
    setLlmContent('');
    setError(null);

    // Use cache if available, except for the stateless Task Handoff app.
    if (app.id !== 'task_handoff_app' && appContentCache[cacheKey]) {
      setLlmContent(appContentCache[cacheKey]);
      setIsLoading(false);
    } else {
      internalHandleLlmRequest(newHistory, MAX_HISTORY_LENGTH, null);
    }
  };

  const windowTitle = activeApp ? activeApp.name : 'MichaelWalshOS Computer';
  const contentBgColor = '#ffffff';

  return (
    <div className="bg-gradient-to-br from-blue-100 to-purple-200 w-full min-h-screen flex items-center justify-center p-4">
      <Window
        title={windowTitle}
        isAppOpen={!!activeApp}
        appId={activeApp?.id}
        onExitToDesktop={handleCloseAppView}>
        <div
          className="w-full h-full"
          style={{backgroundColor: contentBgColor}}>
          {!activeApp ? (
            <DesktopView apps={appDefinitions} onAppOpen={handleAppOpen} />
          ) : (
            <>
              {isLoading && llmContent.length === 0 && (
                <div className="flex justify-center items-center h-full">
                  <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500"></div>
                </div>
              )}
              {error && (
                <div className="p-4 text-red-600 bg-red-100 rounded-md">
                  {error}
                </div>
              )}
              {(!isLoading || llmContent) && (
                <GeneratedContent
                  htmlContent={llmContent}
                  onInteract={handleInteraction}
                  appContext={activeApp.id}
                  isLoading={isLoading}
                />
              )}
            </>
          )}
        </div>
      </Window>
    </div>
  );
};

export default App;