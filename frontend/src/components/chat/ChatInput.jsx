import { useState, useRef } from "react";

const SendIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m22 2-7 20-4-9-9-4Z"/>
    <path d="M22 2 11 13"/>
  </svg>
);

function ChatInput({ onSend }) {
  const [input, setInput] = useState("");
  const textareaRef = useRef(null);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    if (!input.trim()) return;
    onSend(input);
    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleInput = (e) => {
    const target = e.target;
    target.style.height = "auto";
    target.style.height = `${Math.min(target.scrollHeight, 128)}px`;
    setInput(target.value);
  };

  return (
    <div className="relative bg-[#16161E] rounded-2xl border border-[#2A2A35] focus-within:border-purple-500 transition-colors">
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        placeholder="Ask about your emails, schedule, or anything else..."
        className="w-full bg-transparent text-gray-100 placeholder-gray-500 px-5 py-4 pr-14 resize-none outline-none max-h-32"
        rows={1}
        style={{ minHeight: "56px" }}
      />
      <button
        onClick={handleSend}
        disabled={!input.trim()}
        className={`absolute right-3 bottom-3 p-2 rounded-lg transition-all ${
          input.trim()
            ? "bg-purple-600 hover:bg-purple-700 text-white"
            : "bg-[#2A2A35] text-gray-500 cursor-not-allowed"
        }`}
      >
        <SendIcon />
      </button>
    </div>
  );
}

export default ChatInput;
