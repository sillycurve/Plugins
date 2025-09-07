import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, UserStore, RestAPI, ChannelStore, Menu, React, Toasts } from "@webpack/common";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";

const settings = definePluginSettings({
    enabled: {
        type: OptionType.BOOLEAN,
        description: "Enable MimicTroll plugin",
        default: true,
    },
    delay: {
        type: OptionType.NUMBER,
        description: "Delay before sending mimic message (milliseconds)",
        default: 1000,
        validators: [value => value >= 500 && value <= 10000]
    },
    mimicPrefix: {
        type: OptionType.STRING,
        description: "Prefix to add before mimic messages (optional)",
        default: "",
    },
    showMimicStatus: {
        type: OptionType.BOOLEAN,
        description: "Show status messages when starting/stopping mimic",
        default: true,
    },
    filterStrength: {
        type: OptionType.SELECT,
        description: "Content filter strength",
        options: [
            { label: "Standard", value: "standard" },
            { label: "Strict", value: "strict" }
        ],
        default: "strict",
    },
    blockedResponse: {
        type: OptionType.STRING,
        description: "Message to send when content is blocked",
        default: "Nice try buddy",
    }
});

interface MimicTarget {
    userId: string;
    username: string;
    channelId: string;
    active: boolean;
    startTime: number;
}

class ContentFilter {
    // Core prohibited terms
    private static readonly BLOCKED_TERMS = [
        // Age-related inappropriate content
        "underage", "under age", "minor", "child", "kid", "young", "teen", "teenager",
        "cp", "c p", "child porn", "childporn", "loli", "shota", "pedo", "pedophile",
        "im underage", "i'm underage", "i am underage", "13", "14", "15", "16",
        "years old", "yo ", " yo", "age verification", "jailbait",

        // Add other categories as needed
        "illegal", "drugs", "weapons", "harm", "suicide", "self harm"
    ];

    // Unicode character mappings for bypass detection
    private static readonly UNICODE_REPLACEMENTS: { [key: string]: string } = {
        // Cyrillic look-alikes
        'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x',
        'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O',
        'Р': 'P', 'С': 'C', 'Т': 'T', 'У': 'Y', 'Х': 'X',

        // Greek look-alikes
        'α': 'a', 'β': 'b', 'γ': 'y', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'n',
        'θ': 'o', 'ι': 'i', 'κ': 'k', 'λ': 'l', 'μ': 'm', 'ν': 'v', 'ξ': 'e',
        'ο': 'o', 'π': 'n', 'ρ': 'p', 'σ': 'o', 'τ': 't', 'υ': 'y', 'φ': 'o',
        'χ': 'x', 'ψ': 'y', 'ω': 'w',

        // Mathematical and other Unicode
        '𝐚': 'a', '𝐛': 'b', '𝐜': 'c', '𝐝': 'd', '𝐞': 'e', '𝐟': 'f', '𝐠': 'g',
        '𝐡': 'h', '𝐢': 'i', '𝐣': 'j', '𝐤': 'k', '𝐥': 'l', '𝐦': 'm', '𝐧': 'n',
        '𝐨': 'o', '𝐩': 'p', '𝐪': 'q', '𝐫': 'r', '𝐬': 's', '𝐭': 't', '𝐮': 'u',
        '𝐯': 'v', '𝐰': 'w', '𝐱': 'x', '𝐲': 'y', '𝐳': 'z',

        // Full-width characters
        'ａ': 'a', 'ｂ': 'b', 'ｃ': 'c', 'ｄ': 'd', 'ｅ': 'e', 'ｆ': 'f', 'ｇ': 'g',
        'ｈ': 'h', 'ｉ': 'i', 'ｊ': 'j', 'ｋ': 'k', 'ｌ': 'l', 'ｍ': 'm', 'ｎ': 'n',
        'ｏ': 'o', 'ｐ': 'p', 'ｑ': 'q', 'ｒ': 'r', 'ｓ': 's', 'ｔ': 't', 'ｕ': 'u',
        'ｖ': 'v', 'ｗ': 'w', 'ｘ': 'x', 'ｙ': 'y', 'ｚ': 'z',

        // Numbers and symbols often used in bypasses
        '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
        '@': 'a', '$': 's', '!': 'i', '|': 'l', '()': 'o', '[]': 'o',

        // Zero-width and invisible characters
        '\u200B': '', '\u200C': '', '\u200D': '', '\uFEFF': '', '\u2060': '',
        '\u00A0': ' ', '\u2000': ' ', '\u2001': ' ', '\u2002': ' ', '\u2003': ' ',
        '\u2004': ' ', '\u2005': ' ', '\u2006': ' ', '\u2007': ' ', '\u2008': ' ',
        '\u2009': ' ', '\u200A': ' ',
    };

    public static normalizeText(text: string): string {
        let normalized = text.toLowerCase();

        // Replace Unicode look-alikes
        for (const [unicode, replacement] of Object.entries(this.UNICODE_REPLACEMENTS)) {
            normalized = normalized.replace(new RegExp(unicode, 'g'), replacement);
        }

        // Remove excessive punctuation and spacing
        normalized = normalized.replace(/[^\w\s]/g, ' ');
        normalized = normalized.replace(/\s+/g, ' ');
        normalized = normalized.trim();

        // Handle l33t speak and common substitutions
        const leetMap: { [key: string]: string } = {
            '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b',
            '@': 'a', '$': 's', '!': 'i', '|': 'l', 'ph': 'f', 'ck': 'k'
        };

        for (const [leet, normal] of Object.entries(leetMap)) {
            normalized = normalized.replace(new RegExp(leet, 'g'), normal);
        }

        return normalized;
    }

    public static containsBlockedContent(message: string): boolean {
        const normalizedMessage = this.normalizeText(message);

        // Check against blocked terms
        for (const term of this.BLOCKED_TERMS) {
            const normalizedTerm = this.normalizeText(term);

            // Direct match
            if (normalizedMessage.includes(normalizedTerm)) {
                console.log(`[MimicTroll] 🚫 Blocked content detected: "${term}"`);
                return true;
            }

            // Spaced out version (e.g., "u n d e r a g e")
            const spacedTerm = normalizedTerm.split('').join(' ');
            if (normalizedMessage.includes(spacedTerm)) {
                console.log(`[MimicTroll] 🚫 Blocked spaced content detected: "${term}"`);
                return true;
            }

            // Check for terms with extra characters inserted
            const regex = new RegExp(normalizedTerm.split('').join('[^a-z]*'), 'i');
            if (regex.test(normalizedMessage)) {
                console.log(`[MimicTroll] 🚫 Blocked obfuscated content detected: "${term}"`);
                return true;
            }
        }

        // Additional pattern-based checks
        if (this.containsSuspiciousPatterns(normalizedMessage)) {
            return true;
        }

        return false;
    }

    private static containsSuspiciousPatterns(message: string): boolean {
        // Age declarations
        const agePatterns = [
            /i.*am.*\d{1,2}$/,
            /im.*\d{1,2}$/,
            /\d{1,2}.*years.*old/,
            /\d{1,2}.*yo/,
            /age.*\d{1,2}/,
            /born.*\d{4}/
        ];

        for (const pattern of agePatterns) {
            if (pattern.test(message)) {
                const match = message.match(/\d+/);
                if (match) {
                    const age = parseInt(match[0]);
                    if (age < 18 && age > 5) { // Reasonable age range
                        console.log(`[MimicTroll] 🚫 Blocked age declaration: ${age}`);
                        return true;
                    }
                }
            }
        }

        // Check for excessive obfuscation (too many special characters)
        const specialCharCount = (message.match(/[^a-z0-9\s]/g) || []).length;
        const totalLength = message.length;
        if (totalLength > 10 && (specialCharCount / totalLength) > 0.4) {
            console.log(`[MimicTroll] 🚫 Blocked heavily obfuscated message`);
            return true;
        }

        return false;
    }

    public static getBlockedResponse(): string {
        const responses = [
            settings.store.blockedResponse,
            "Nice try buddy",
        ];

        return responses[Math.floor(Math.random() * responses.length)];
    }
}

class MimicManager {
    private activeTargets = new Map<string, MimicTarget>();
    private messageQueue: Array<{channelId: string, content: string, delay: number}> = [];
    private isProcessing = false;

    constructor() {
        this.processQueue();
    }

    public addTarget(userId: string, username: string, channelId: string): boolean {
        if (userId === UserStore.getCurrentUser()?.id) {
            console.log("[MimicTroll] Cannot mimic yourself!");
            return false;
        }

        this.activeTargets.set(userId, {
            userId,
            username,
            channelId,
            active: true,
            startTime: Date.now()
        });

        console.log(`[MimicTroll] 🎯 Started mimicking ${username} (${userId}) with content filtering enabled`);
        return true;
    }

    public removeTarget(userId: string): boolean {
        const target = this.activeTargets.get(userId);
        if (target) {
            this.activeTargets.delete(userId);
            console.log(`[MimicTroll] ℹ️ Stopped mimicking ${target.username}`);
            return true;
        }
        return false;
    }

    public toggleTarget(userId: string, username: string, channelId: string): boolean {
        if (this.activeTargets.has(userId)) {
            return this.removeTarget(userId);
        } else {
            return this.addTarget(userId, username, channelId);
        }
    }

    public isTargetActive(userId: string): boolean {
        return this.activeTargets.has(userId);
    }

    public handleMessage(message: any) {
        if (!settings.store.enabled) return;

        const target = this.activeTargets.get(message.author.id);
        if (!target || !target.active) return;

        // Don't mimic bot messages or system messages
        if (message.author.bot || message.type !== 0) return;

        // Don't mimic empty messages
        if (!message.content || message.content.trim() === "") return;

        // Content filtering check
        let mimicContent = message.content;
        if (ContentFilter.containsBlockedContent(mimicContent)) {
            console.log(`[MimicTroll] 🚫 Blocked and replaced harmful content from ${message.author.username}`);
            mimicContent = ContentFilter.getBlockedResponse();
        }

        // Add prefix if configured
        if (settings.store.mimicPrefix) {
            mimicContent = settings.store.mimicPrefix + " " + mimicContent;
        }

        // Queue the message to be sent
        this.queueMessage(target.channelId, mimicContent);
    }

    private queueMessage(channelId: string, content: string) {
        this.messageQueue.push({
            channelId,
            content,
            delay: settings.store.delay
        });
    }

    private async processQueue() {
        setInterval(async () => {
            if (this.isProcessing || this.messageQueue.length === 0) return;

            this.isProcessing = true;

            while (this.messageQueue.length > 0) {
                const message = this.messageQueue.shift()!;

                try {
                    await this.sendMessage(message.channelId, message.content);
                    console.log(`[MimicTroll] 📤 Sent mimic message: "${message.content}"`);
                } catch (error) {
                    console.error(`[MimicTroll] ❌ Failed to send message:`, error);
                }

                // Wait between messages to avoid rate limiting
                await this.sleep(Math.random() * 500 + 200);
            }

            this.isProcessing = false;
        }, 100);
    }

    private async sendMessage(channelId: string, content: string): Promise<boolean> {
        try {
            await RestAPI.post({
                url: `/channels/${channelId}/messages`,
                body: {
                    content: content,
                    tts: false,
                    flags: 0
                }
            });
            return true;
        } catch (error) {
            console.error(`[MimicTroll] Failed to send message via API:`, error);
            return false;
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    public clearQueue() {
        this.messageQueue = [];
        this.isProcessing = false;
    }

    public clearAllTargets() {
        this.activeTargets.clear();
        this.clearQueue();
    }
}

const mimicManager = new MimicManager();

// Get current channel ID from URL
function getCurrentChannelId(): string {
    const path = window.location.pathname;
    const matches = path.match(/\/channels\/[^\/]+\/(\d+)/);
    return matches ? matches[1] : '';
}

// User context menu patch
const UserContext: NavContextMenuPatchCallback = (children, props) => {
    if (!settings.store.enabled) return;

    const { user } = props;
    if (!user) return;

    const currentUser = UserStore.getCurrentUser();
    if (!currentUser || user.id === currentUser.id) return;

    const channelId = props?.channel?.id ?? ChannelStore.getDMFromUserId(user.id) ?? getCurrentChannelId();
    const mimicItem = MimicMenuItem(user.id, user.username, channelId);

    children.splice(-1, 0, <Menu.MenuGroup>{mimicItem}</Menu.MenuGroup>);
};

function MimicMenuItem(userId: string, username: string, channelId: string) {
    const [isChecked, setIsChecked] = React.useState(mimicManager.isTargetActive(userId));

    return (
        <Menu.MenuCheckboxItem
            id="mimic-user"
            label="Mimic (Filtered)"
            checked={isChecked}
            action={async () => {
                const wasActive = mimicManager.isTargetActive(userId);
                const success = mimicManager.toggleTarget(userId, username, channelId);

                if (success) {
                    setIsChecked(!isChecked);

                    if (settings.store.showMimicStatus) {
                        const statusMessage = wasActive
                            ? `ℹ️ Stopped mimicking **${username}**`
                            : `✅ Started mimicking **${username}** with content filtering`;

                        Toasts.show({
                            message: statusMessage,
                            id: "mimic-troll-status",
                            type: wasActive ? Toasts.Type.MESSAGE : Toasts.Type.SUCCESS,
                            options: {
                                position: Toasts.Position.BOTTOM,
                            }
                        });
                    }
                } else {
                    Toasts.show({
                        message: "❌ Failed to toggle mimic status",
                        id: "mimic-troll-error",
                        type: Toasts.Type.FAILURE,
                        options: {
                            position: Toasts.Position.BOTTOM,
                        }
                    });
                }
            }}
        />
    );
}

// Handle message events for mimicking
function handleMessageCreate(data: any) {
    if (!settings.store.enabled) return;

    const message = data.message;
    if (!message?.author || !message.id || !message.channel_id) return;

    // Handle regular messages for mimicking
    mimicManager.handleMessage(message);
}

const contextMenus = {
    "user-context": UserContext
};

export default definePlugin({
    name: "MimicTroll",
    description: "Right-click users and toggle 'Mimic' to copy their messages with content filtering for safety",
    authors: [{ name: "curve", id: 818846027511103508n }],

    settings,
    contextMenus,

    start() {
        FluxDispatcher.subscribe("MESSAGE_CREATE", handleMessageCreate);
        console.log("[MimicTroll] 🎭 Plugin started successfully with advanced content filtering");
        console.log("[MimicTroll] Right-click any user and toggle 'Mimic (Filtered)' to start/stop copying their messages");
        console.log("[MimicTroll] 🛡️ Content filtering is active to prevent harmful message mimicking");
    },

    stop() {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", handleMessageCreate);
        mimicManager.clearAllTargets();
        console.log("[MimicTroll] 🛑 Plugin stopped");
    },
});
