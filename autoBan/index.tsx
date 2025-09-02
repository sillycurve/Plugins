import definePlugin, { OptionType } from "@utils/types";
import { Toasts, FluxDispatcher, UserStore, GuildStore, GuildMemberStore } from "@webpack/common";
import { definePluginSettings } from "@api/Settings";
import { findStoreLazy, findByPropsLazy } from "@webpack";
import { Menu, RestAPI, React, Button, TextInput, ChannelStore, ContextMenuApi, PermissionStore, Forms, GuildChannelStore } from "@webpack/common";
import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, openModal, ModalSize } from "@utils/modal";

const VoiceStateStore = findStoreLazy("VoiceStateStore");
let banthisni = null;
const sessionStore = findByPropsLazy("getSessionId");
let isCurrentlyVcOwner = false;
let currentVcChannel = null;
let currentVcGuild = null; // Add this to track current guild

const settings = definePluginSettings({
    users: {
        type: OptionType.STRING,
        description: "User list separated by /",
        default: "",
    },
    store: {
        type: OptionType.STRING,
        description: "reasons and shit",
        default: "",
    },
    autoBanDelay: {
        type: OptionType.NUMBER,
        description: "Delay before auto-banning (seconds)",
        default: 2,
    },
    showVcOwnerStatus: {
        type: OptionType.BOOLEAN,
        description: "Show VC owner status notifications",
        default: true,
    },
    enableBulkAutoban: {
        type: OptionType.BOOLEAN,
        description: "Enable Bulk Autoban options in context menu",
        default: true,
    },
});

function isVoiceChannelOwner(guildId: string, channelId: string): boolean {
    if (!guildId || !channelId) return false;
    
    try {
        // Get the VC owner detector plugin settings
        const vcOwnerPlugin = Vencord.Plugins.plugins.vcOwnerDetector;
        if (!vcOwnerPlugin || !vcOwnerPlugin.settings) return false;
        
        // Check the simple boolean flag first (this is updated by the VC owner detector)
        if (vcOwnerPlugin.settings.store.amivcowner) {
            return true;
        }
        
        // Fallback: replicate the VC owner detector logic
        const guildDetectionSettings = isValidJson(vcOwnerPlugin.settings.store.guildidetectionslol);
        const guildSetting = guildDetectionSettings.find(g => g.name === guildId);
        
        if (!guildSetting) return false;
        
        const channel = ChannelStore.getChannel(channelId);
        if (!channel?.permissionOverwrites) return false;
        
        const permissions = Object.values(channel.permissionOverwrites);
        const currentUserId = UserStore.getCurrentUser().id;
        const permRequirement = guildSetting.permrequirements;
        
        for (const perm of permissions) {
            const { id, allow } = perm;
            
            try {
                const allowBigInt = toBigIntSafe(allow);
                const reqBigInt = toBigIntSafe(permRequirement);
                
                if (allowBigInt === reqBigInt && id === currentUserId) {
                    return true;
                }
            } catch (e) {
                console.error("Permission conversion error:", e);
            }
        }
        
        return false;
    } catch (e) {
        console.error("VC owner check error:", e);
        return false;
    }
}

// Function to monitor VC ownership changes
function checkVcOwnershipStatus() {
    const currentUserId = UserStore.getCurrentUser().id;
    const currentVoiceState = VoiceStateStore.getVoiceStateForUser(currentUserId);
    
    if (!currentVoiceState?.channelId) {
        // Not in any VC
        if (isCurrentlyVcOwner) {
            isCurrentlyVcOwner = false;
            currentVcChannel = null;
            currentVcGuild = null; // Reset guild as well
            if (settings.store.showVcOwnerStatus) {
                Toasts.show({
                    message: "🔴 No longer VC owner (left voice channel)",
                    id: "vc-owner-status-left",
                    type: Toasts.Type.MESSAGE,
                    options: {
                        position: Toasts.Position.BOTTOM,
                        duration: 3000
                    }
                });
            }
        }
        return;
    }
    
    const channel = ChannelStore.getChannel(currentVoiceState.channelId);
    if (!channel?.guild_id) return;
    
    const wasOwner = isCurrentlyVcOwner;
    const wasInSameChannel = currentVcChannel === currentVoiceState.channelId;
    
    isCurrentlyVcOwner = isVoiceChannelOwner(channel.guild_id, currentVoiceState.channelId);
    currentVcChannel = currentVoiceState.channelId;
    currentVcGuild = channel.guild_id; // Store the guild ID
    
    // Show notifications for ownership changes
    if (settings.store.showVcOwnerStatus && (!wasInSameChannel || wasOwner !== isCurrentlyVcOwner)) {
        if (isCurrentlyVcOwner) {
            Toasts.show({
                message: "🟢 You are now the VC owner",
                id: "vc-owner-status-gained",
                type: Toasts.Type.SUCCESS,
                options: {
                    position: Toasts.Position.BOTTOM,
                    duration: 3000
                }
            });
            
            // Auto-ban existing users in VC after a short delay
            setTimeout(() => {
                checkExistingUsersInVC(currentVoiceState.channelId);
            }, 1000);
        } else if (wasOwner) {
            Toasts.show({
                message: "🔴 No longer VC owner",
                id: "vc-owner-status-lost",
                type: Toasts.Type.MESSAGE,
                options: {
                    position: Toasts.Position.BOTTOM,
                    duration: 3000
                }
            });
        }
    }
}

// Helper functions from the VC owner detector
function toBigIntSafe(value: any): bigint {
    if (typeof value === "bigint") return value;
    if (typeof value === "number") return BigInt(value);
    if (typeof value === "string") return BigInt(value.replace(/n$/, "").trim());
    return BigInt(0);
}

function isValidJson(data: string): any[] {
    try { 
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) { 
        return []; 
    }
}

// Bulk operations
function getAllUsersInVc(channelId: string): string[] {
    const currentUserId = UserStore.getCurrentUser().id;
    const voiceStates = VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {};
    return Object.keys(voiceStates).filter(userId => userId !== currentUserId);
}

function getAllUsersInCurrentVc(): string[] {
    const currentUserId = UserStore.getCurrentUser().id;
    const currentVoiceState = VoiceStateStore.getVoiceStateForUser(currentUserId);
    
    if (!currentVoiceState?.channelId) return [];
    
    const voiceStates = VoiceStateStore.getVoiceStatesForChannel(currentVoiceState.channelId) ?? {};
    return Object.keys(voiceStates).filter(userId => userId !== currentUserId);
}

function banAllUsersInVc(channelId: string): void {
    const usersInVc = getAllUsersInVc(channelId);
    if (usersInVc.length === 0) {
        Toasts.show({
            message: "No other users in this VC",
            id: "no-users-in-vc",
            type: Toasts.Type.MESSAGE,
            options: { position: Toasts.Position.BOTTOM }
        });
        return;
    }
    
    const currentBannedUsers = settings.store.users.split('/').filter(item => item !== '');
    const newUsers = usersInVc.filter(userId => !currentBannedUsers.includes(userId));
    
    if (newUsers.length === 0) {
        Toasts.show({
            message: "All users in VC are already on auto-ban list",
            id: "all-already-banned",
            type: Toasts.Type.MESSAGE,
            options: { position: Toasts.Position.BOTTOM }
        });
        return;
    }
    
    const allBannedUsers = [...currentBannedUsers, ...newUsers];
    settings.store.users = allBannedUsers.join('/');
    
    Toasts.show({
        message: `Added ${newUsers.length} users to auto-ban list`,
        id: "bulk-ban-added",
        type: Toasts.Type.SUCCESS,
        options: { position: Toasts.Position.BOTTOM }
    });
    
    // Check if we're in the target channel and are VC owner
    const currentUserId = UserStore.getCurrentUser().id;
    const currentVoiceState = VoiceStateStore.getVoiceStateForUser(currentUserId);
    const channel = ChannelStore.getChannel(channelId);
    
    if (currentVoiceState?.channelId === channelId && 
        channel?.guild_id && 
        isVoiceChannelOwner(channel.guild_id, channelId)) {
        // Auto-ban the new users if we're VC owner in this channel
        newUsers.forEach(userId => {
            setTimeout(() => banninguser(userId), Math.random() * 1000); // Stagger bans to avoid rate limits
        });
    }
}

function banAllUsersInCurrentVc(): void {
    const usersInVc = getAllUsersInCurrentVc();
    if (usersInVc.length === 0) {
        Toasts.show({
            message: "No other users in current VC",
            id: "no-users-in-vc",
            type: Toasts.Type.MESSAGE,
            options: { position: Toasts.Position.BOTTOM }
        });
        return;
    }
    
    const currentBannedUsers = settings.store.users.split('/').filter(item => item !== '');
    const newUsers = usersInVc.filter(userId => !currentBannedUsers.includes(userId));
    
    if (newUsers.length === 0) {
        Toasts.show({
            message: "All users in VC are already on auto-ban list",
            id: "all-already-banned",
            type: Toasts.Type.MESSAGE,
            options: { position: Toasts.Position.BOTTOM }
        });
        return;
    }
    
    const allBannedUsers = [...currentBannedUsers, ...newUsers];
    settings.store.users = allBannedUsers.join('/');
    
    Toasts.show({
        message: `Added ${newUsers.length} users to auto-ban list`,
        id: "bulk-ban-added",
        type: Toasts.Type.SUCCESS,
        options: { position: Toasts.Position.BOTTOM }
    });
    
    // Auto-ban the new users if we're VC owner
    if (isCurrentlyVcOwner) {
        newUsers.forEach(userId => {
            setTimeout(() => banninguser(userId), Math.random() * 1000); // Stagger bans to avoid rate limits
        });
    }
}

// User context menu patch (for individual auto-ban)
function makeUserContextMenuPatch(): NavContextMenuPatchCallback {
    return (children, props) => {
        if (!props) return;
        
        // Add individual user auto-ban option
        const ban = MenuItem(props.user.id);
        if (ban) {
            children.splice(-1, 0, <Menu.MenuGroup>{ban}</Menu.MenuGroup>);
        }
    };
}

// Channel context menu patch (for bulk auto-ban)
function makeChannelContextMenuPatch(): NavContextMenuPatchCallback {
    return (children, props) => {
        if (!props || !props.channel) return;
        
        // Only show for voice channels
        if (props.channel.type !== 2) return; // Type 2 is voice channel
        
        // Add bulk autoban submenu if enabled
        if (settings.store.enableBulkAutoban) {
            const bulkAutoBanSubmenu = BulkAutoBanSubmenuForChannel(props.channel.id);
            if (bulkAutoBanSubmenu) {
                children.splice(-1, 0, <Menu.MenuGroup>{bulkAutoBanSubmenu}</Menu.MenuGroup>);
            }
        }
    };
}

function BulkAutoBanSubmenuForChannel(channelId: string) {
    const currentUserId = UserStore.getCurrentUser().id;
    const channel = ChannelStore.getChannel(channelId);
    
    if (!channel || !channel.guild_id) return null;
    
    const usersInVc = getAllUsersInVc(channelId);
    const currentVoiceState = VoiceStateStore.getVoiceStateForUser(currentUserId);
    const isInThisChannel = currentVoiceState?.channelId === channelId;
    const isOwnerOfThisChannel = isInThisChannel && isVoiceChannelOwner(channel.guild_id, channelId);
    
    let vcOwnerStatus;
    if (isInThisChannel) {
        vcOwnerStatus = isOwnerOfThisChannel ? "🟢 VC Owner" : "🔴 Not VC Owner";
    } else {
        vcOwnerStatus = "⚫ Not in this VC";
    }
    
    return (
        <Menu.MenuItem
            id="bulk-autoban-submenu-channel"
            label="Bulk Autoban"
        >
            <Menu.MenuItem
                id="bulk-autoban-all-in-channel"
                label={`Ban All in VC (${usersInVc.length} users)`}
                color="danger"
                action={() => banAllUsersInVc(channelId)}
            />
            <Menu.MenuSeparator />
            <Menu.MenuItem
                id="bulk-autoban-channel-status"
                label={vcOwnerStatus}
                disabled={true}
                color={isOwnerOfThisChannel ? "brand" : "default"}
            />
        </Menu.MenuItem>
    );
}

function BulkAutoBanSubmenu() {
    const currentUserId = UserStore.getCurrentUser().id;
    const currentVoiceState = VoiceStateStore.getVoiceStateForUser(currentUserId);
    
    // Only show if user is in a voice channel
    if (!currentVoiceState?.channelId) return null;
    
    const usersInVc = getAllUsersInCurrentVc();
    const vcOwnerStatus = isCurrentlyVcOwner ? "🟢 VC Owner" : "🔴 Not VC Owner";
    
    return (
        <Menu.MenuItem
            id="bulk-autoban-submenu"
            label="Bulk Autoban"
        >
            <Menu.MenuItem
                id="bulk-autoban-all-vc"
                label={`Ban All in VC (${usersInVc.length} users)`}
                color="danger"
                action={() => banAllUsersInCurrentVc()}
            />
            <Menu.MenuSeparator />
            <Menu.MenuItem
                id="bulk-autoban-status"
                label={vcOwnerStatus}
                disabled={true}
                color={isCurrentlyVcOwner ? "brand" : "default"}
            />
        </Menu.MenuItem>
    );
}

function MenuItem(id: string) {
    if (UserStore.getCurrentUser().id === id) return;
    const [isChecked, setIsChecked] = React.useState(settings.store.users.split('/').filter(item => item !== '').includes(id));
    return (
        <Menu.MenuCheckboxItem
            id="auto-ban"
            label="Auto-Ban"
            checked={isChecked}
            action={async () => {
                openModal(props => <EncModals {...props} userId={id} />);
                const updatedList = [...settings.store.users.split('/').filter(item => item !== '')];
                const index = updatedList.indexOf(id);
                const wasAdded = index === -1;
                
                if (index === -1) updatedList.push(id);
                else updatedList.splice(index, 1);
                setIsChecked(!isChecked);
                settings.store.users = updatedList.join("/");
                
                // If user was just added to ban list, attempt immediate ban
                if (wasAdded) {
                    banninguser(id);
                } else {
                    // User was removed from list
                    Toasts.show({
                        message: `Removed ${id} from Auto-Ban List`,
                        id: "auto-ban-removed",
                        type: Toasts.Type.MESSAGE,
                        options: {
                            position: Toasts.Position.BOTTOM
                        }
                    });
                }
            }}
        />
    );
}

function banninguser(id) {
    const currentUserId = UserStore.getCurrentUser().id;
    
    // Get current voice state with multiple fallback methods
    let currentVoiceState = VoiceStateStore.getVoiceStateForUser(currentUserId);
    let channelId = currentVoiceState?.channelId;
    let guildId = null;
    
    // First fallback: use global tracking variables
    if (!channelId && currentVcChannel) {
        channelId = currentVcChannel;
        guildId = currentVcGuild;
        console.log("Using fallback channel and guild:", channelId, guildId);
    }
    
    // Second fallback: try to find user in any voice channel
    if (!channelId) {
        // Look through all guilds to find where current user is in voice
        const guilds = GuildStore.getGuilds();
        for (const guild of Object.values(guilds)) {
            const channels = GuildChannelStore.getVoiceChannels(guild.id);
            for (const channel of channels) {
                const voiceStates = VoiceStateStore.getVoiceStatesForChannel(channel.id) ?? {};
                if (Object.keys(voiceStates).includes(currentUserId)) {
                    channelId = channel.id;
                    guildId = guild.id;
                    console.log("Found user in voice channel via search:", channelId, guildId);
                    break;
                }
            }
            if (channelId) break;
        }
    }
    
    if (!channelId) {
        Toasts.show({
            message: `Not in voice channel - ${id} added to auto-ban list`,
            id: "not-in-vc-added",
            type: Toasts.Type.MESSAGE,
            options: {
                position: Toasts.Position.BOTTOM
            }
        });
        return;
    }
    
    // Get guild ID if we don't have it yet
    if (!guildId) {
        const channel = ChannelStore.getChannel(channelId);
        guildId = channel?.guild_id;
    }
    
    if (!guildId) {
        Toasts.show({
            message: `Cannot determine guild - ${id} added to auto-ban list`,
            id: "no-guild-added",
            type: Toasts.Type.MESSAGE,
            options: {
                position: Toasts.Position.BOTTOM
            }
        });
        return;
    }
    
    // Check VC ownership with multiple methods
    let isOwner = false;
    
    // Method 1: Use global tracking if we're in the same channel
    if (channelId === currentVcChannel && isCurrentlyVcOwner) {
        isOwner = true;
        console.log("Using global VC owner status");
    } else {
        // Method 2: Direct check using VC owner detector logic
        isOwner = isVoiceChannelOwner(guildId, channelId);
        console.log("Direct VC owner check result:", isOwner);
    }
    
    if (!isOwner) {
        Toasts.show({
            message: `Not the VC owner - ${id} added to auto-ban list`,
            id: "not-vc-owner-added-general",
            type: Toasts.Type.MESSAGE,
            options: {
                position: Toasts.Position.BOTTOM
            }
        });
        return;
    }
    
    // Check if target user is actually in the same VC
    const targetVoiceState = VoiceStateStore.getVoiceStateForUser(id);
    if (!targetVoiceState?.channelId || targetVoiceState.channelId !== channelId) {
        Toasts.show({
            message: `User ${id} not in your VC - added to auto-ban list`,
            id: "target-not-in-vc",
            type: Toasts.Type.MESSAGE,
            options: {
                position: Toasts.Position.BOTTOM
            }
        });
        return;
    }
    
    // We are VC owner and target is in same VC - proceed with ban
    Toasts.show({
        message: `Added ${id} to Auto-Ban List & Auto-banning`,
        id: "auto-ban-success",
        type: Toasts.Type.SUCCESS,
        options: {
            position: Toasts.Position.BOTTOM
        }
    });
    
    // Add configurable delay before banning
    setTimeout(() => {
        RestAPI.post({
            url: `/channels/${channelId}/messages`,
            body: { content: `!voice-ban ${id}`, nonce: (Math.floor(Math.random() * 10000000000000)) }
        });
    }, settings.store.autoBanDelay * 1000);
}

// New function to check existing users in voice channel
function checkExistingUsersInVC(channelId: string) {
    const voiceStates = VoiceStateStore.getVoiceStatesForChannel(channelId) ?? {};
    const bannedUsers = settings.store.users.split('/').filter(item => item !== '');
    const currentUserId = UserStore.getCurrentUser().id;
    
    // Check if current user is in the voice channel
    if (!Object.keys(voiceStates).includes(currentUserId)) return;
    
    // Get guild ID for the channel
    const channel = ChannelStore.getChannel(channelId);
    if (!channel?.guild_id) return;
    
    // Check if we're actually the VC owner using the detector's logic
    if (!isVoiceChannelOwner(channel.guild_id, channelId)) {
        return;
    }
    
    // Check each user in the voice channel
    Object.keys(voiceStates).forEach((userId, index) => {
        if (userId === currentUserId) return; // Don't ban yourself
        
        if (bannedUsers.includes(userId)) {
            Toasts.show({
                message: `Auto banning existing User ${userId} in voice channel <3`,
                id: "auto-ban-existing",
                type: Toasts.Type.FAILURE,
                options: {
                    position: Toasts.Position.BOTTOM
                }
            });
            
            // Stagger bans to avoid rate limits
            setTimeout(() => {
                RestAPI.post({
                    url: `/channels/${channelId}/messages`,
                    body: { content: `!voice-ban ${userId}`, nonce: (Math.floor(Math.random() * 10000000000000)) }
                });
            }, (index + 1) * settings.store.autoBanDelay * 1000);
        }
    });
}

function EncModals(props) {
    const { userId } = props;
    const currentReasons = settings.store.store.split('.').filter(Boolean);
    const existingReasonEntry = currentReasons.find(entry => entry.startsWith(`${userId}/`));
    const existingReason = existingReasonEntry ? existingReasonEntry.split('/')[1] : "";
    const [reason, setReason] = React.useState(existingReason);

    return (
        <ModalRoot {...props} size={ModalSize.DYNAMIC}>
            <ModalHeader>
                <Forms.FormTitle tag="h4">Autoban Reason</Forms.FormTitle>
            </ModalHeader>
            <ModalContent>
                <TextInput
                    style={{ marginBottom: "10px", minWidth: "600px" }}
                    value={reason}
                    placeholder="Enter the reason for banning this user"
                    onChange={setReason}
                />
            </ModalContent>
            <ModalFooter>
                <Button
                    color={Button.Colors.GREEN}
                    onClick={() => {
                        const updatedReasons = currentReasons.filter(entry => !entry.startsWith(`${userId}/`));
                        updatedReasons.push(`${userId}/${reason}`);
                        settings.store.store = updatedReasons.join(".");
                        settings.store.users = settings.store.users.includes(userId) ? settings.store.users : `${settings.store.users}/${userId}`;
                        props.onClose();
                    }}
                >
                    Confirm reason
                </Button>
                <Button
                    color={Button.Colors.TRANSPARENT}
                    look={Button.Looks.LINK}
                    onClick={props.onClose}
                >
                    Close
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

export default definePlugin({
    name: "autoBan",
    description: "Tools to automatically ban users. Fixed by curve",
    authors: [{ name: "curve", id: 818846027511103508n }, { name: "dot", id: 1400606596521791773n }],
    settings,
    contextMenus: {
        "user-context": makeUserContextMenuPatch(),
        "channel-context": makeChannelContextMenuPatch()
    },
    start() { 
        FluxDispatcher.subscribe("VOICE_STATE_UPDATES", cb);
        
        // Start monitoring VC ownership changes
        this.vcOwnershipInterval = setInterval(checkVcOwnershipStatus, 2000);
        
        // Initial check
        setTimeout(checkVcOwnershipStatus, 1000);
    },
    
    stop() {
        FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", cb);
        
        // Stop monitoring VC ownership
        if (this.vcOwnershipInterval) {
            clearInterval(this.vcOwnershipInterval);
        }
    }
});

const cb = async (e) => {
    const state = e.voiceStates[0];
    if (!state?.channelId) return;
    
    const currentUserId = UserStore.getCurrentUser().id;
    const Cvcstates = VoiceStateStore.getVoiceStatesForChannel(state?.channelId) ?? {};
    
    // Check if current user just joined a voice channel
    if (state.userId === currentUserId && state?.channelId !== state?.oldChannelId && state?.channelId) {
        // Small delay to ensure voice state is fully updated, then check ownership
        setTimeout(() => {
            checkVcOwnershipStatus();
        }, 500);
        return;
    }
    
    // Original logic for when someone else joins
    if (state?.channelId == state?.oldChannelId) return;
    if (!Object.keys(Cvcstates).includes(currentUserId)) return;
    
    if (settings.store.users.split('/').filter(item => item !== '').includes(state.userId)) {
        // Use the VC owner detector's logic instead of the unreliable plugin flag
        if (!isVoiceChannelOwner(state.guildId, state.channelId)) {
            Toasts.show({
                message: `Not the VC owner - ${state.userId} already on auto-ban list`,
                id: "not-vc-owner-existing",
                type: Toasts.Type.MESSAGE,
                options: {
                    position: Toasts.Position.BOTTOM
                }
            });
            return;
        }
        
        Toasts.show({
            message: `Auto banning User ${state.userId}`,
            id: "auto-ban",
            type: Toasts.Type.FAILURE,
            options: {
                position: Toasts.Position.BOTTOM
            }
        });
        
        // Add configurable delay before auto-banning
        setTimeout(() => {
            RestAPI.post({
                url: `/channels/${state.channelId}/messages`,
                body: { content: `!voice-ban ${state.userId}`, nonce: (Math.floor(Math.random() * 10000000000000)) }
            });
        }, settings.store.autoBanDelay * 1000);
    }
};