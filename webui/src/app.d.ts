// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

// Import chat types from dedicated module

import type {
	// API types
	ApiChatCompletionRequest,
	ApiChatCompletionResponse,
	ApiChatCompletionStreamChunk,
	ApiChatCompletionToolCall,
	ApiChatCompletionToolCallDelta,
	ApiChatMessageData,
	ApiChatMessageContentPart,
	ApiContextSizeError,
	ApiErrorResponse,
	ApiLlamaCppServerProps,
	ApiModelDataEntry,
	ApiModelListResponse,
	ApiProcessingState,
	ApiRouterModelMeta,
	ApiRouterModelsLoadRequest,
	ApiRouterModelsLoadResponse,
	ApiRouterModelsStatusRequest,
	ApiRouterModelsStatusResponse,
	ApiRouterModelsListResponse,
	ApiRouterModelsUnloadRequest,
	ApiRouterModelsUnloadResponse,
	// Chat types
	ChatAttachmentDisplayItem,
	ChatAttachmentPreviewItem,
	ChatMessageType,
	ChatRole,
	ChatUploadedFile,
	ChatMessageSiblingInfo,
	ChatMessagePromptProgress,
	ChatMessageTimings,
	// Database types
	DatabaseConversation,
	DatabaseMessage,
	DatabaseMessageExtra,
	DatabaseMessageExtraAudioFile,
	DatabaseMessageExtraImageFile,
	DatabaseMessageExtraTextFile,
	DatabaseMessageExtraPdfFile,
	DatabaseMessageExtraLegacyContext,
	ExportedConversation,
	ExportedConversations,
	// Model types
	ModelModalities,
	ModelOption,
	// Settings types
	SettingsChatServiceOptions,
	SettingsConfigValue,
	SettingsFieldConfig,
	SettingsConfigType
} from '$lib/types';

import { ServerRole, ServerModelStatus, ModelModality } from '$lib/enums';

declare global {
	// namespace App {
	// interface Error {}
	// interface Locals {}
	// interface PageData {}
	// interface PageState {}
	// interface Platform {}
	// }

	export {
		// API types
		ApiChatCompletionRequest,
		ApiChatCompletionResponse,
		ApiChatCompletionStreamChunk,
		ApiChatCompletionToolCall,
		ApiChatCompletionToolCallDelta,
		ApiChatMessageData,
		ApiChatMessageContentPart,
		ApiContextSizeError,
		ApiErrorResponse,
		ApiLlamaCppServerProps,
		ApiModelDataEntry,
		ApiModelListResponse,
		ApiProcessingState,
		ApiRouterModelMeta,
		ApiRouterModelsLoadRequest,
		ApiRouterModelsLoadResponse,
		ApiRouterModelsStatusRequest,
		ApiRouterModelsStatusResponse,
		ApiRouterModelsListResponse,
		ApiRouterModelsUnloadRequest,
		ApiRouterModelsUnloadResponse,
		// Chat types
		ChatAttachmentDisplayItem,
		ChatAttachmentPreviewItem,
		ChatMessagePromptProgress,
		ChatMessageSiblingInfo,
		ChatMessageTimings,
		ChatMessageType,
		ChatRole,
		ChatUploadedFile,
		// Database types
		DatabaseConversation,
		DatabaseMessage,
		DatabaseMessageExtra,
		DatabaseMessageExtraAudioFile,
		DatabaseMessageExtraImageFile,
		DatabaseMessageExtraTextFile,
		DatabaseMessageExtraPdfFile,
		DatabaseMessageExtraLegacyContext,
		ExportedConversation,
		ExportedConversations,
		// Enum types
		ModelModality,
		ServerRole,
		ServerModelStatus,
		// Model types
		ModelModalities,
		ModelOption,
		// Settings types
		SettingsChatServiceOptions,
		SettingsConfigValue,
		SettingsFieldConfig,
		SettingsConfigType
	};
}

interface LlamaAPI {
	getServerStatus: () => Promise<boolean>;
	startServer: () => Promise<boolean>;
	stopServer: () => Promise<boolean>;
	downloadModels: () => Promise<void>;
	getModelsDirectory: () => Promise<string>;
	setSelectedModels: (modelNames: string[]) => Promise<void>;
	getSelectedModels: () => Promise<string[]>;
	getAppDataDirectory: () => Promise<string>;
	openDataFolder: () => Promise<void>;
	getInstalledModels: () => Promise<string[]>;
	deleteModel: (filename: string) => Promise<void>;
	switchModel: (filename: string) => Promise<void>;
	searchHuggingFace: (repoId: string, hfToken?: string) => Promise<any>;
	downloadHuggingFaceModel: (repoId: string, filename: string, hfToken?: string) => Promise<any>;
	getDownloadProgress: (downloadId: string) => Promise<any>;
	getAllDownloadProgress: () => Promise<any>;
	getStorageInfo: () => Promise<any>;
	goBackToMain: () => Promise<void>;
	onDownloadComplete: (callback: (data: any) => void) => void;
	offDownloadComplete: (callback: (data: any) => void) => void;
	registerUser: (username: string, password: string, email?: string, bio?: string) => Promise<any>;
	loginUser: (username: string, password: string) => Promise<any>;
	getCurrentUser: () => Promise<any>;
	logoutUser: () => Promise<void>;
	updateUserProfile: (updates: Record<string, unknown>) => Promise<any>;
	webSearch: (query: string, maxResults?: number) => Promise<{ success: boolean; results?: Array<{ title: string; url: string; snippet: string }>; error?: string }>;
	fetchWebPage: (url: string) => Promise<{ success: boolean; content?: string; url?: string; error?: string }>;
	// Embedded jCodeMunch code retrieval
	jcmHealthCheck: () => Promise<{ available: boolean; error?: string }>;
	jcmIndexRepo: (repoUrl: string) => Promise<{ success: boolean; content?: string; error?: string }>;
	jcmIndexFolder: (folderPath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
	jcmSearchSymbols: (repo: string, query: string, maxResults?: number, kind?: string) => Promise<{ success: boolean; content?: string; error?: string }>;
	jcmGetSymbolSource: (repo: string, symbolId: string) => Promise<{ success: boolean; content?: string; error?: string }>;
	jcmListRepos: () => Promise<{ success: boolean; content?: string; error?: string }>;
	jcmGetRepoOutline: (repo: string) => Promise<{ success: boolean; content?: string; error?: string }>;
	jcmGetFileTree: (repo: string, pathPrefix?: string) => Promise<{ success: boolean; content?: string; error?: string }>;
	jcmGetFileContent: (repo: string, filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
	jcmGetContextBundle: (repo: string, symbolId: string, includeCallers?: boolean) => Promise<{ success: boolean; content?: string; error?: string }>;
	jcmGetFileOutline: (repo: string, filePath: string) => Promise<{ success: boolean; content?: string; error?: string }>;
	jcmInvalidateCache: (repo: string) => Promise<{ success: boolean; content?: string; error?: string }>;
	// Local folder picker
	selectLocalFolder: () => Promise<{ canceled: boolean; folderPath?: string }>;
}

declare global {
	interface Window {
		idxThemeStyle?: number;
		idxCodeBlock?: number;
		llamaAPI?: LlamaAPI;
	}
}
