/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/* tslint:disable */
import React, {useEffect, useRef} from 'react';
import {InteractionData} from './types';

interface GeneratedContentProps {
  htmlContent: string;
  onInteract: (data: InteractionData) => void;
  appContext: string | null;
  isLoading: boolean; // Added isLoading prop
}

export const GeneratedContent: React.FC<GeneratedContentProps> = ({
  htmlContent,
  onInteract,
  appContext,
  isLoading,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const processedHtmlContentRef = useRef<string | null>(null); // Ref to track processed content

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    const handleClick = (event: MouseEvent) => {
      let targetElement = event.target as HTMLElement;

      // If a user clicks on an input or textarea to focus it for typing,
      // do not process it as an interaction unless the element itself has an interaction ID.
      // This prevents the click from bubbling up and triggering a parent element's handler.
      if (
        (targetElement.tagName === 'INPUT' ||
          targetElement.tagName === 'TEXTAREA') &&
        !targetElement.dataset.interactionId
      ) {
        return;
      }

      while (
        targetElement &&
        targetElement !== container &&
        !targetElement.dataset.interactionId
      ) {
        targetElement = targetElement.parentElement as HTMLElement;
      }

      if (targetElement && targetElement.dataset.interactionId) {
        event.preventDefault();

        let interactionValue: string | undefined =
          targetElement.dataset.interactionValue;

        if (targetElement.dataset.valueFrom) {
          const valueFrom = targetElement.dataset.valueFrom;
          // Check if valueFrom is a JSON string for multiple inputs
          if (valueFrom.trim().startsWith('{')) {
            try {
              const idMap = JSON.parse(valueFrom);
              const values: Record<string, string> = {};
              for (const key in idMap) {
                const inputElement = document.getElementById(idMap[key]) as
                  | HTMLInputElement
                  | HTMLTextAreaElement;
                if (inputElement) {
                  values[key] = inputElement.value;
                }
              }
              interactionValue = JSON.stringify(values);
            } catch (e) {
              console.error(
                'Failed to parse data-value-from JSON. Make sure it is valid JSON.',
                valueFrom,
                e,
              );
            }
          } else {
            // Handle single input case
            const inputElement = document.getElementById(valueFrom) as
              | HTMLInputElement
              | HTMLTextAreaElement;
            if (inputElement) {
              interactionValue = inputElement.value;
            }
          }
        }

        const interactionData: InteractionData = {
          id: targetElement.dataset.interactionId,
          type: targetElement.dataset.interactionType || 'generic_click',
          value: interactionValue,
          elementType: targetElement.tagName.toLowerCase(),
          elementText: (
            targetElement.innerText ||
            (targetElement as HTMLInputElement).value ||
            ''
          )
            .trim()
            .substring(0, 75),
          appContext: appContext,
        };
        onInteract(interactionData);
      }
    };

    container.addEventListener('click', handleClick);

    // Process scripts only when loading is complete and content has changed
    if (!isLoading) {
      if (htmlContent !== processedHtmlContentRef.current) {
        const scripts = Array.from(container.getElementsByTagName('script'));
        // FIX: Explicitly type `oldScript` as `HTMLScriptElement` to resolve type inference issues.
        scripts.forEach((oldScript: HTMLScriptElement) => {
          try {
            const newScript = document.createElement('script');
            Array.from(oldScript.attributes).forEach((attr) =>
              newScript.setAttribute(attr.name, attr.value),
            );
            newScript.text = oldScript.innerHTML;

            if (oldScript.parentNode) {
              oldScript.parentNode.replaceChild(newScript, oldScript);
            } else {
              console.warn(
                'Script tag found without a parent node:',
                oldScript,
              );
            }
          } catch (e) {
            console.error(
              'Error processing/executing script tag. This usually indicates a syntax error in the LLM-generated script.',
              {
                scriptContent:
                  oldScript.innerHTML.substring(0, 500) +
                  (oldScript.innerHTML.length > 500 ? '...' : ''),
                error: e,
              },
            );
          }
        });
        processedHtmlContentRef.current = htmlContent; // Mark this content as processed
      }
    } else {
      // If loading, reset the processed content ref. This ensures that when loading finishes,
      // the new content (even if identical to a previous state before loading) is processed.
      processedHtmlContentRef.current = null;
    }

    return () => {
      container.removeEventListener('click', handleClick);
    };
  }, [htmlContent, onInteract, appContext, isLoading]);

  return (
    <div
      ref={contentRef}
      className="w-full h-full overflow-y-auto"
      dangerouslySetInnerHTML={{__html: htmlContent}}
    />
  );
};