export const sidebarStyles = {
  sidebar:
    "h-screen bg-[#16161E] border-r border-[#2A2A35] flex flex-col transition-all duration-300 ease-in-out",

  sidebarExpanded: "w-64",

  sidebarCollapsed: "w-16",

  header:
    "px-4 py-5 border-b border-[#2A2A35] flex items-center justify-between",

  headerCollapsed: "px-4 py-5 border-b border-[#2A2A35] flex items-center justify-center",

  logo: "text-xl font-semibold text-white transition-opacity duration-200",

  logoHidden: "opacity-0 w-0 overflow-hidden",

  newChatButton:
    "p-2 rounded-lg bg-purple-600 hover:bg-purple-700 transition text-white flex items-center justify-center gap-2 w-full",

  historySection: "flex-1 overflow-y-auto px-3 py-4",

  historySectionCollapsed: "flex-1 overflow-y-auto px-2 py-4",

  historyTitle: "text-xs font-medium text-gray-500 uppercase tracking-wider mb-3 px-2 transition-opacity duration-200",

  historyTitleHidden: "opacity-0 h-0 overflow-hidden mb-0",

  historyItem:
    "w-full text-left px-3 py-2.5 rounded-lg text-gray-400 hover:bg-[#1E1E28] hover:text-white transition mb-1 truncate text-sm",

  historyItemCollapsed:
    "w-full flex items-center justify-center py-2.5 rounded-lg text-gray-400 hover:bg-[#1E1E28] hover:text-white transition mb-1",

  historyItemActive:
    "w-full text-left px-3 py-2.5 rounded-lg bg-[#2A2A35] text-white mb-1 truncate text-sm",

  emptyHistory: "text-gray-600 text-sm px-2 py-4 text-center",

  loginPrompt:
    "text-gray-500 text-sm px-4 py-6 text-center border-t border-[#2A2A35]",

  loginPromptCollapsed:
    "text-gray-500 text-sm px-2 py-4 text-center",

  footer:
    "px-4 py-4 border-t border-[#2A2A35]",

  footerCollapsed:
    "px-2 py-4 border-t border-[#2A2A35] flex justify-center",

  profileButton:
    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#1E1E28] transition",

  profileButtonCollapsed:
    "flex items-center justify-center p-2 rounded-lg hover:bg-[#1E1E28] transition",

  profileAvatar:
    "w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-medium flex-shrink-0",

  profileInfo: "flex-1 min-w-0 transition-opacity duration-200",

  profileInfoHidden: "opacity-0 w-0 overflow-hidden",

  profileName: "text-sm font-medium text-white truncate",

  profileEmail: "text-xs text-gray-500 truncate",

  chatIcon: "w-5 h-5 text-gray-500",

  toggleButton: "p-2 rounded-lg hover:bg-[#2A2A35] transition text-gray-400 hover:text-white",

  newChatSection: "px-4 mb-4",

  // Profile Menu Dropdown
  profileMenu: "absolute bottom-full left-0 mb-2 w-48 bg-[#16161E] border border-[#2A2A35] rounded-lg shadow-xl overflow-hidden z-50",

  profileMenuItem: "w-full px-4 py-3 flex items-center gap-3 text-left text-white hover:bg-[#2A2A35] transition text-sm",

  profileMenuItemDanger: "text-red-400 hover:bg-red-500/10 hover:text-red-300",
};
