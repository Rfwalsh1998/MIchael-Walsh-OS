/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/* tslint:disable */
import React from 'react';

interface WindowProps {
  title: string;
  children: React.ReactNode;
  isAppOpen: boolean;
  appId?: string | null;
  onExitToDesktop: () => void;
}

export const Window: React.FC<WindowProps> = ({
  title,
  children,
  isAppOpen,
  onExitToDesktop,
}) => {
  return (
    <div className="w-full max-w-4xl h-[90vh] max-h-[700px] bg-white/80 backdrop-blur-md border border-gray-300 rounded-xl shadow-2xl flex flex-col relative overflow-hidden font-sans">
      {/* Title Bar */}
      <div className="bg-gray-800/90 text-white py-2 px-4 font-semibold text-base flex justify-between items-center select-none cursor-default rounded-t-xl flex-shrink-0">
        <span className="title-bar-text">{title}</span>
        {isAppOpen && (
          <button
            onClick={onExitToDesktop}
            className="w-6 h-6 bg-red-500 rounded-full text-white flex items-center justify-center text-sm font-bold hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-400 transition-colors"
            aria-label="Close application and return to Desktop">
            &#x2715;
          </button>
        )}
      </div>

      {/* Menu Bar */}
      <div className="bg-gray-100/80 py-1 px-3 border-b border-gray-200 select-none flex-shrink-0">
        {/* Placeholder for a more traditional menu bar. Can be built out with File, Edit, etc. */}
      </div>

      {/* Content */}
      <div className="flex-grow overflow-y-auto">{children}</div>
    </div>
  );
};
