import { useEffect, useRef } from "react";
import Message from "./Message";
import ChatInput from "./ChatInput";
import TypingIndicator from "./TypingIndicator";
import { useChatStore } from "../../store/chatStore";

const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const XIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

function ChatWindow() {
  const { messages, isTyping, sendMessage, pendingConfirmation, confirmAction } = useChatStore();
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (messages.length > 0 || isTyping) {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    }
  }, [messages, isTyping]);

  const handleSend = (text) => {
    sendMessage(text);
  };

  if (messages.length === 0) {
    return (
      <div className="flex flex-col flex-1 min-h-0 bg-[#0D0D12]">
        <div className="hidden lg:flex items-center justify-between p-6 border-b border-[#2A2A35]">
          <div>
            <h2 className="text-white text-xl">Chat</h2>
            <p className="text-gray-400 text-sm mt-1">Powered by your email and calendar insights</p>
          </div>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-4">
          <div className="text-center mb-10">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center mx-auto mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
              </svg>
            </div>
            <h2 className="text-2xl font-medium text-white mb-3">How can I help you today?</h2>
            <p className="text-gray-400">Ask me about your emails, schedule, or anything else.</p>
          </div>
          <div className="w-full max-w-3xl">
            <ChatInput onSend={handleSend} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-[#0D0D12]">
      <div className="hidden lg:flex items-center justify-between p-6 border-b border-[#2A2A35]">
        <div>
          <h2 className="text-white text-xl">Chat</h2>
          <p className="text-gray-400 text-sm mt-1">Powered by your email and calendar insights</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {messages.map((msg, idx) => (
            <Message key={idx} role={msg.role} text={msg.text} isError={msg.isError} context={msg.context} mode={msg.mode} />
          ))}
          {isTyping && <TypingIndicator />}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="border-t border-[#2A2A35] bg-[#0D0D12] px-4 py-4">
        <div className="max-w-3xl mx-auto">
          {pendingConfirmation ? (
            <div className="bg-[#16161E] rounded-2xl border border-purple-500/30 px-5 py-4">
              <p className="text-sm text-gray-400 text-center mb-3">
                Shall I go ahead and create this event?
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => confirmAction("confirmed")}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors"
                >
                  <CheckIcon />
                  Yes, create it
                </button>
                <button
                  onClick={() => confirmAction("rejected")}
                  className="flex items-center gap-2 px-5 py-2 rounded-xl bg-[#2A2A35] hover:bg-[#3A3A45] text-gray-300 text-sm font-medium transition-colors"
                >
                  <XIcon />
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <ChatInput onSend={handleSend} />
          )}
        </div>
      </div>
    </div>
  );
}

export default ChatWindow;
