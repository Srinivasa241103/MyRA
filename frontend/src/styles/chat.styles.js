export const chatStyles = {
  page:
    "h-screen overflow-hidden bg-[#0D0D12] text-white flex justify-center",

  pageInner:
    "w-full max-w-5xl px-6 py-6 flex flex-col h-full overflow-hidden",

  header:
    "shrink-0 mb-4 px-6 py-4 text-xl font-semibold rounded-xl border border-[#2A2A35] bg-[#16161E] text-center",

  chatWindow:
    "flex flex-col flex-1 min-h-0 overflow-hidden",

  messages:
    "flex-1 min-h-0 overflow-y-auto px-4 py-6 flex flex-col gap-6",

  inputWrapper:
    "shrink-0 border-t border-[#2A2A35] px-4 py-4 bg-[#0D0D12]",

  userMessage:
    "inline-block bg-[#5B5BD6] text-white px-4 py-3 rounded-2xl max-w-[85%]",

  aiMessage:
    "inline-block bg-[#16161E] text-gray-100 px-4 py-3 rounded-2xl max-w-[85%]",

  input:
    "w-full bg-transparent text-gray-100 placeholder-gray-500 px-5 py-4 pr-14 resize-none outline-none",

  sendButton:
    "absolute right-3 bottom-3 p-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white transition-all disabled:bg-[#2A2A35] disabled:text-gray-500 disabled:cursor-not-allowed",
};
