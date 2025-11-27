/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/* tslint:disable */
import {Blob, GoogleGenAI, GenerateContentResponse, Modality} from '@google/genai';
import {APP_DEFINITIONS_CONFIG, getSystemPrompt} from './constants'; // Import getSystemPrompt and APP_DEFINITIONS_CONFIG
import {InteractionData} from './types';

if (!process.env.API_KEY) {
  // This is a critical error. In a real app, you might throw or display a persistent error.
  // For this environment, logging to console is okay, but the app might not function.
  console.error(
    'API_KEY environment variable is not set. The application will not be able to connect to the Gemini API.',
  );
}

const ai = new GoogleGenAI({apiKey: process.env.API_KEY!}); // The "!" asserts API_KEY is non-null after the check.

/**
 * Generates an appropriate emoji icon for a new application using the Gemini API.
 * @param appName The name of the new application.
 * @param appDescription The description of the new application.
 * @returns A promise that resolves to a single emoji string.
 */
export async function generateAppIcon(
  appName: string,
  appDescription: string,
): Promise<string> {
  const model = 'gemini-2.5-flash';
  if (!process.env.API_KEY) {
    console.error('API_KEY not set, cannot generate icon.');
    return '❓'; // Return a default fallback emoji
  }

  const prompt = `You are an expert iconographer. Your task is to select the perfect single emoji for an application based on its name and description.
  
  App Name: "${appName}"
  App Description: "${appDescription}"
  
  Provide only a single, relevant emoji. Do not include any other text, explanation, or punctuation. For example, if the app is a "Weather App", a good response is "☀️".`;

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: model,
      contents: prompt,
    });
    const emoji = response.text?.trim() || '📦';
    // A simple validation to check if it's likely an emoji and not a long string
    if (/\p{Emoji}/u.test(emoji) && emoji.length <= 5) {
      return emoji;
    }
    console.warn('Generated icon was not a valid emoji, using fallback.');
    return '📦'; // Fallback for invalid response
  } catch (error) {
    console.error('Error generating app icon:', error);
    return '⚠️'; // Error emoji
  }
}

/**
 * Generates an image using Gemini 2.5 Flash Image (Nano Banana).
 */
export async function generateImageWithGemini(
  prompt: string,
  aspectRatio: string,
): Promise<string> {
  // Gemini 2.5 Flash Image does not support aspectRatio in config, so we add it to the prompt.
  const enhancedPrompt = `${prompt}. Aspect ratio: ${aspectRatio}`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [{text: enhancedPrompt}],
    },
    config: {
      responseModalities: [Modality.IMAGE],
    },
  });

  const part = response.candidates?.[0]?.content?.parts?.[0];
  if (part?.inlineData?.data) {
    return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
  }
  throw new Error('No image generated');
}

/**
 * Generates a video using Veo.
 */
export async function generateVideoWithVeo(
  prompt: string,
  aspectRatio: string,
): Promise<string> {
  // Important: We must instantiate a NEW GoogleGenAI client here.
  // This is because Veo requires the user to select an API key via window.aistudio.
  // The SDK likely picks up this selected key from the environment or internal state
  // when a new client is created after selection.
  const currentAi = new GoogleGenAI({apiKey: process.env.API_KEY!});

  let operation = await currentAi.models.generateVideos({
    model: 'veo-3.1-fast-generate-preview',
    prompt: prompt,
    config: {
      numberOfVideos: 1,
      resolution: '720p',
      aspectRatio: aspectRatio as '16:9' | '9:16',
    },
  });

  while (!operation.done) {
    await new Promise((resolve) => setTimeout(resolve, 5000)); // Poll every 5 seconds
    operation = await currentAi.operations.getVideosOperation({
      operation: operation,
    });
  }

  const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!videoUri) {
    throw new Error('No video generated');
  }

  // Fetch the actual video bytes
  const videoResponse = await fetch(`${videoUri}&key=${process.env.API_KEY}`);
  if (!videoResponse.ok) {
    throw new Error('Failed to download video content');
  }
  const videoBlob = await videoResponse.blob();
  return URL.createObjectURL(videoBlob);
}

// --- Audio Helpers for Live API ---

export function createPcmBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  
  let binary = '';
  const bytes = new Uint8Array(int16.buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);

  return {
    data: base64,
    mimeType: 'audio/pcm;rate=16000',
  };
}

export function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export async function* streamAppContent(
  interactionHistory: InteractionData[],
  currentMaxHistoryLength: number, // Receive current max history length
  previousContent: string | null,
): AsyncGenerator<string, void, void> {
  const model = 'gemini-2.5-flash'; // Updated model

  if (!process.env.API_KEY) {
    yield `<div class="p-4 text-red-700 bg-red-100 rounded-lg">
      <p class="font-bold text-lg">Configuration Error</p>
      <p class="mt-2">The API_KEY is not configured. Please set the API_KEY environment variable.</p>
    </div>`;
    return;
  }

  if (interactionHistory.length === 0) {
    yield `<div class="p-4 text-orange-700 bg-orange-100 rounded-lg">
      <p class="font-bold text-lg">No interaction data provided.</p>
    </div>`;
    return;
  }

  const systemPrompt = getSystemPrompt(currentMaxHistoryLength); // Generate system prompt dynamically

  const currentInteraction = interactionHistory[0];
  // pastInteractions already respects currentMaxHistoryLength due to slicing in App.tsx
  const pastInteractions = interactionHistory.slice(1);

  const currentElementName =
    currentInteraction.elementText ||
    currentInteraction.id ||
    'Unknown Element';
  let currentInteractionSummary = `Current User Interaction: Clicked on '${currentElementName}' (Type: ${currentInteraction.type || 'N/A'}, ID: ${currentInteraction.id || 'N/A'}).`;
  if (currentInteraction.value) {
    currentInteractionSummary += ` Associated value: '${currentInteraction.value.substring(0, 100)}'.`;
  }

  const currentAppDef = APP_DEFINITIONS_CONFIG.find(
    (app) => app.id === currentInteraction.appContext,
  );
  const currentAppContext = currentInteraction.appContext
    ? `Current App Context: '${currentAppDef?.name || currentInteraction.appContext}'.`
    : 'No specific app context for current interaction.';

  let historyPromptSegment = '';
  if (pastInteractions.length > 0) {
    // The number of previous interactions to mention in the prompt text.
    const numPrevInteractionsToMention =
      currentMaxHistoryLength - 1 > 0 ? currentMaxHistoryLength - 1 : 0;
    historyPromptSegment = `\n\nPrevious User Interactions (up to ${numPrevInteractionsToMention} most recent, oldest first in this list segment but chronologically before current):`;

    // Iterate over the pastInteractions array, which is already correctly sized
    pastInteractions.forEach((interaction, index) => {
      const pastElementName =
        interaction.elementText || interaction.id || 'Unknown Element';
      const appDef = APP_DEFINITIONS_CONFIG.find(
        (app) => app.id === interaction.appContext,
      );
      const appName = interaction.appContext
        ? appDef?.name || interaction.appContext
        : 'N/A';
      historyPromptSegment += `\n${index + 1}. (App: ${appName}) Clicked '${pastElementName}' (Type: ${interaction.type || 'N/A'}, ID: ${interaction.id || 'N/A'})`;
      if (interaction.value) {
        historyPromptSegment += ` with value '${interaction.value.substring(0, 50)}'`;
      }
      historyPromptSegment += '.';
    });
  }

  let previousContentSegment = '';
  if (previousContent) {
    // Sanitize and truncate the HTML to keep the prompt reasonable.
    const sanitizedContent = previousContent.replace(
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      '',
    );
    const truncatedContent = sanitizedContent.substring(0, 2500);
    previousContentSegment = `\n\n**Previous Screen Content (The user was viewing this when they took the current action):**
---
${truncatedContent}${sanitizedContent.length > 2500 ? '...' : ''}
---`;
  }

  const fullPrompt = `${systemPrompt}
${previousContentSegment}

${currentInteractionSummary}
${currentAppContext}
${historyPromptSegment}

Full Context for Current Interaction (for your reference, primarily use summaries and history):
${JSON.stringify(currentInteraction, null, 1)}

Generate the HTML content for the window's content area only:`;

  // --- Agentic Tool Configuration ---
  const config: any = {};

  const isTaskHandoffAgentActive =
    currentInteraction.appContext === 'task_handoff_app' &&
    currentInteraction.type !== 'app_open';

  const isWebBrowserActive =
    currentInteraction.appContext === 'web_browser_app' &&
    currentInteraction.type !== 'app_open';

  // Enable Google Search tool for the Task Handoff app and Web Browser app, but not on their initial opening screens.
  if (isTaskHandoffAgentActive || isWebBrowserActive) {
    config.tools = [{googleSearch: {}}];
  }
  // --- End Agentic Tool Configuration ---

  try {
    const response = await ai.models.generateContentStream({
      model: model,
      contents: fullPrompt,
      config: config,
    });

    const allGroundingChunks = new Map<string, string>(); // Use a Map to store unique URIs and their titles

    for await (const chunk of response) {
      if (chunk.text) {
        yield chunk.text;
      }
      // Extract grounding metadata from each chunk
      const groundingMetadata = chunk.candidates?.[0]?.groundingMetadata;
      if (groundingMetadata?.groundingChunks) {
        for (const chunkInfo of groundingMetadata.groundingChunks) {
          if (chunkInfo.web) {
            allGroundingChunks.set(chunkInfo.web.uri, chunkInfo.web.title);
          }
        }
      }
    }

    // After the stream is complete, if we have collected any sources, yield them as a final HTML block.
    if (allGroundingChunks.size > 0) {
      let sourcesHtml =
        '<div class="llm-container mt-4 border-t pt-2"><h3 class="llm-title text-base">Sources</h3><ul class="list-disc list-inside">';
      allGroundingChunks.forEach((title, uri) => {
        // Sanitize URI and title before inserting into HTML
        const safeUri = encodeURI(uri);
        const safeTitle = title
          ? title.replace(/</g, '&lt;').replace(/>/g, '&gt;')
          : safeUri;
        sourcesHtml += `<li class="llm-text text-sm ml-2"><a href="${safeUri}" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline">${safeTitle}</a></li>`;
      });
      sourcesHtml += '</ul></div>';
      yield sourcesHtml;
    }
  } catch (error) {
    console.error('Error streaming from Gemini:', error);
    let errorMessage = 'An error occurred while generating content.';
    // Check if error is an instance of Error and has a message property
    if (error instanceof Error && typeof error.message === 'string') {
      errorMessage += ` Details: ${error.message}`;
    } else if (
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      typeof (error as any).message === 'string'
    ) {
      // Handle cases where error might be an object with a message property (like the API error object)
      errorMessage += ` Details: ${(error as any).message}`;
    } else if (typeof error === 'string') {
      errorMessage += ` Details: ${error}`;
    }

    yield `<div class="p-4 text-red-700 bg-red-100 rounded-lg">
      <p class="font-bold text-lg">Error Generating Content</p>
      <p class="mt-2">${errorMessage}</p>
      <p class="mt-1">This may be due to an API key issue, network problem, or misconfiguration. Please check the developer console for more details.</p>
    </div>`;
  }
}