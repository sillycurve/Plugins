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
    }
});

interface MimicTarget {
    userId: string;
    username: string;
    channelId: string;
    active: boolean;
    startTime: number;
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

        console.log(`[MimicTroll] 🎯 Started mimicking ${username} (${userId})`);
        return true;
    }

    public removeTarget(userId: string): boolean {
        const target = this.activeTargets.get(userId);
        if (target) {
            this.activeTargets.delete(userId);
            console.log(`[MimicTroll] ⏹️ Stopped mimicking ${target.username}`);
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

        // Prepare the mimic message
        let mimicContent = message.content;
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
            label="Mimic"
            checked={isChecked}
            action={async () => {
                const wasActive = mimicManager.isTargetActive(userId);
                const success = mimicManager.toggleTarget(userId, username, channelId);

                if (success) {
                    setIsChecked(!isChecked);

                    if (settings.store.showMimicStatus) {
                        const statusMessage = wasActive
                            ? `⏹️ Stopped mimicking **${username}**`
                            : `✅ Started mimicking **${username}** in this channel`;

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
    description: "Right-click users and toggle 'Mimic' to copy their messages in real time",
    authors: [{ name: "curve", id: 818846027511103508n }],

    settings,
    contextMenus,

    start() {
        FluxDispatcher.subscribe("MESSAGE_CREATE", handleMessageCreate);
        console.log("[MimicTroll] 🎭 Plugin started successfully");
        console.log("[MimicTroll] Right-click any user and toggle 'Mimic' to start/stop copying their messages");
    },

    stop() {
        FluxDispatcher.unsubscribe("MESSAGE_CREATE", handleMessageCreate);
        mimicManager.clearAllTargets();
        console.log("[MimicTroll] 🛑 Plugin stopped");
    },
});
