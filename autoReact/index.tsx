import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, UserStore, RestAPI } from "@webpack/common";

const settings = definePluginSettings({
    emojis: {
        type: OptionType.STRING,
        description: "Emoji(s) to react with (comma separated for multiple)",
        default: "👍",
    },
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable auto-react",
        default: true,
    },
    delay: {
        type: OptionType.NUMBER,
        description: "Delay before reacting (milliseconds)",
        default: 500,
        validators: [value => value >= 100 && value <= 5000]
    },
    enabledChannels: {
        type: OptionType.STRING,
        description: "Specific channel IDs (comma separated, leave empty for all channels)",
        default: "",
    },
    reactionChance: {
        type: OptionType.NUMBER,
        description: "Chance to react (0-100%)",
        default: 100,
        validators: [value => value >= 0 && value <= 100]
    }
});

interface QueuedReaction {
    channelId: string;
    messageId: string;
    emoji: string;
    timestamp: number;
}

class AutoReactManager {
    private reactionQueue: QueuedReaction[] = [];
    private isProcessing = false;
    private rateLimitWindow = new Map<string, number[]>();

    constructor() {
        // Clean up rate limit tracking every minute
        setInterval(() => this.cleanupRateLimit(), 60000);
    }

    private cleanupRateLimit() {
        const now = Date.now();
        for (const [key, timestamps] of this.rateLimitWindow.entries()) {
            const filtered = timestamps.filter(ts => now - ts < 60000);
            if (filtered.length === 0) {
                this.rateLimitWindow.delete(key);
            } else {
                this.rateLimitWindow.set(key, filtered);
            }
        }
    }

    private checkRateLimit(channelId: string): boolean {
        const now = Date.now();
        const key = `${channelId}`;
        const timestamps = this.rateLimitWindow.get(key) || [];

        // Discord allows ~5 reactions per 5 seconds per channel
        const recentReactions = timestamps.filter(ts => now - ts < 5000);

        if (recentReactions.length >= 5) {
            console.log(`[AutoReact] Rate limit hit for channel ${channelId}`);
            return false;
        }

        timestamps.push(now);
        this.rateLimitWindow.set(key, timestamps);
        return true;
    }

    public queueReaction(channelId: string, messageId: string, emoji: string) {
        // Remove duplicates
        const existing = this.reactionQueue.findIndex(
            r => r.channelId === channelId && r.messageId === messageId && r.emoji === emoji
        );

        if (existing !== -1) {
            this.reactionQueue.splice(existing, 1);
        }

        this.reactionQueue.push({
            channelId,
            messageId,
            emoji,
            timestamp: Date.now()
        });

        this.processQueue();
    }

    private async processQueue() {
        if (this.isProcessing || this.reactionQueue.length === 0) return;

        this.isProcessing = true;

        while (this.reactionQueue.length > 0) {
            // Remove old reactions (older than 10 seconds)
            const now = Date.now();
            this.reactionQueue = this.reactionQueue.filter(r => now - r.timestamp < 10000);

            if (this.reactionQueue.length === 0) break;

            const reaction = this.reactionQueue.shift()!;

            if (!this.checkRateLimit(reaction.channelId)) {
                // Put it back at the end and wait
                this.reactionQueue.push(reaction);
                await this.sleep(1000);
                continue;
            }

            try {
                const success = await this.addReaction(reaction.channelId, reaction.messageId, reaction.emoji);
                if (success) {
                    console.log(`[AutoReact] ✅ Reacted with ${reaction.emoji} to message ${reaction.messageId}`);
                }
            } catch (error) {
                console.error(`[AutoReact] ❌ Failed to react:`, error);
            }

            // Always wait between reactions
            await this.sleep(Math.random() * 200 + 100); // 100-300ms random delay
        }

        this.isProcessing = false;
    }

    private async addReaction(channelId: string, messageId: string, emoji: string): Promise<boolean> {
        // Try API first (most reliable)
        if (await this.addReactionAPI(channelId, messageId, emoji)) {
            return true;
        }

        // Fallback to internal dispatch
        if (await this.addReactionDispatch(channelId, messageId, emoji)) {
            return true;
        }

        console.warn(`[AutoReact] All methods failed for emoji ${emoji}`);
        return false;
    }

    private async addReactionAPI(channelId: string, messageId: string, emoji: string): Promise<boolean> {
        try {
            let encodedEmoji = emoji;

            // Handle custom emoji format <:name:id> or <a:name:id>
            if (emoji.startsWith('<') && emoji.endsWith('>')) {
                const match = emoji.match(/<a?:([^:]+):(\d+)>/);
                if (match) {
                    encodedEmoji = `${match[1]}:${match[2]}`;
                }
            }
            // Handle :name: format by converting to unicode or finding custom emoji
            else if (emoji.startsWith(':') && emoji.endsWith(':')) {
                const emojiName = emoji.slice(1, -1);
                // Try to find custom emoji by name
                const customEmoji = this.findCustomEmoji(emojiName);
                if (customEmoji) {
                    encodedEmoji = `${customEmoji.name}:${customEmoji.id}`;
                } else {
                    // Try unicode emoji
                    const unicodeEmoji = this.nameToUnicode(emojiName);
                    encodedEmoji = unicodeEmoji || emoji;
                }
            }

            await RestAPI.put({
                url: `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(encodedEmoji)}/@me`,
            });

            return true;
        } catch (error) {
            console.warn(`[AutoReact] API method failed:`, error);
            return false;
        }
    }

    private async addReactionDispatch(channelId: string, messageId: string, emoji: string): Promise<boolean> {
        try {
            let processedEmoji = emoji;

            // Convert custom emoji format
            if (emoji.startsWith('<') && emoji.endsWith('>')) {
                const match = emoji.match(/<a?:([^:]+):(\d+)>/);
                if (match) {
                    processedEmoji = {
                        name: match[1],
                        id: match[2],
                        animated: emoji.startsWith('<a:')
                    } as any;
                }
            } else if (emoji.startsWith(':') && emoji.endsWith(':')) {
                const emojiName = emoji.slice(1, -1);
                const customEmoji = this.findCustomEmoji(emojiName);
                if (customEmoji) {
                    processedEmoji = customEmoji as any;
                } else {
                    processedEmoji = this.nameToUnicode(emojiName) || emoji;
                }
            }

            FluxDispatcher.dispatch({
                type: "MESSAGE_REACTION_ADD_USERS",
                channelId,
                messageId,
                emoji: typeof processedEmoji === 'string' ? { name: processedEmoji } : processedEmoji,
                users: [UserStore.getCurrentUser()],
                me: true
            });

            // Also dispatch the optimistic update
            FluxDispatcher.dispatch({
                type: "MESSAGE_REACTION_ADD",
                channelId,
                messageId,
                emoji: typeof processedEmoji === 'string' ? { name: processedEmoji } : processedEmoji,
                userId: UserStore.getCurrentUser()?.id,
                optimistic: true
            });

            return true;
        } catch (error) {
            console.warn(`[AutoReact] Dispatch method failed:`, error);
            return false;
        }
    }

    private findCustomEmoji(name: string) {
        // Try to find emoji in current guild
        const guilds = Object.values((window as any).DiscordNative?.nativeModules?.requireModule('discord_desktop_core')?.guilds || {});

        for (const guild of guilds as any[]) {
            if (guild?.emojis) {
                const emoji = Object.values(guild.emojis).find((e: any) =>
                    e.name?.toLowerCase() === name.toLowerCase()
                );
                if (emoji) return emoji;
            }
        }

        return null;
    }

    private nameToUnicode(name: string): string | null {
        // Basic emoji name to unicode mapping
        const emojiMap: Record<string, string> = {
            'thumbsup': '👍',
            'thumbsdown': '👎',
            'heart': '❤️',
            'fire': '🔥',
            'skull': '💀',
            'eyes': '👀',
            'joy': '😂',
            'sob': '😭',
            'thinking': '🤔',
            'shrug': '🤷',
            'ok_hand': '👌',
            'clap': '👏',
            'pray': '🙏',
            'wave': '👋',
            'point_right': '👉',
            'point_left': '👈',
            'point_up': '👆',
            'point_down': '👇',
            '100': '💯',
            'boom': '💥',
            'sparkles': '✨',
            'star': '⭐',
            'question': '❓',
            'exclamation': '❗',
            'x': '❌',
            'white_check_mark': '✅'
        };

        return emojiMap[name.toLowerCase()] || null;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    public clearQueue() {
        this.reactionQueue = [];
        this.isProcessing = false;
    }
}

const reactionManager = new AutoReactManager();

function handleMessageCreate(data: any) {
    if (!settings.store.enabled) return;

    const message = data.message;
    if (!message?.author || !message.id || !message.channel_id) return;

    // Only react to our own messages
    const currentUser = UserStore.getCurrentUser();
    if (!currentUser || message.author.id !== currentUser.id) return;

    // Check if we should react to this channel
    const enabledChannels = settings.store.enabledChannels.trim();
    if (enabledChannels) {
        const channelList = enabledChannels.split(',').map(id => id.trim());
        if (!channelList.includes(message.channel_id)) return;
    }

    // Check reaction chance
    if (Math.random() * 100 > settings.store.reactionChance) return;

    // Get emojis
    const emojisString = settings.store.emojis.trim();
    if (!emojisString) return;

    const emojis = emojisString.split(',').map(e => e.trim()).filter(e => e);
    if (emojis.length === 0) return;

    // Queue reactions with delay
    setTimeout(() => {
        for (const emoji of emojis) {
            reactionManager.queueReaction(message.channel_id, message.id, emoji);
        }
    }, settings.store.delay);
}

export default definePlugin({
    name: "AutoReact",
    description: "Automatically react to your own messages with customizable emojis",
    authors: [{ name: "curve", id: 818846027511103508n }],

    settings,

    start() {
        FluxDispatcher.subscribe("MESSAGE_CREATE", handleMessageCreate);
        console.log("[AutoReact] 🚀 Plugin started successfully");
    },

    stop() {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", handleMessageCreate);
        reactionManager.clearQueue();
        console.log("[AutoReact] ⛔ Plugin stopped");
    },
});
