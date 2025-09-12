
import { DataStore, Notices } from "@api/index";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { ModalContent, ModalFooter, ModalHeader, ModalProps, ModalSize, ModalRoot } from "@utils/modal";
import { getUniqueUsername, openUserProfile } from "@utils/discord";
import { openModal } from "@utils/modal";
import { OptionType } from "@utils/types";
import definePlugin from "@utils/types";
import { Channel, FluxStore } from "@vencord/discord-types";
import { ChannelType } from "@vencord/discord-types/enums";
import { findStoreLazy } from "@webpack";
import { Button, ChannelStore, Flex, Forms, GuildMemberStore, GuildStore, React, RelationshipStore, Text, TextInput, UserStore, UserUtils } from "@webpack/common";

// Types
interface ChannelDelete {
    type: "CHANNEL_DELETE";
    channel: Channel;
}

interface GuildDelete {
    type: "GUILD_DELETE";
    guild: {
        id: string;
        unavailable?: boolean;
    };
}

interface RelationshipRemove {
    type: "RELATIONSHIP_REMOVE";
    relationship: {
        id: string;
        nickname: string;
        type: number;
    };
}

interface SimpleGroupChannel {
    id: string;
    name: string;
    iconURL?: string;
}

interface SimpleGuild {
    id: string;
    name: string;
    iconURL?: string;
}

interface RelationshipLogEntry {
    id: string;
    type: 'friend' | 'server' | 'group' | 'friendRequest';
    name: string;
    iconURL?: string;
    timestamp: number;
    userId?: string;
}

const enum RelationshipType {
    FRIEND = 1,
    BLOCKED = 2,
    INCOMING_REQUEST = 3,
    OUTGOING_REQUEST = 4,
}

// Settings
const settings = definePluginSettings({
    showNotifications: {
        type: OptionType.BOOLEAN,
        description: "Show desktop notifications when removed",
        default: true
    },
    showNotices: {
        type: OptionType.BOOLEAN,
        description: "Also show a notice at the top of your screen when removed",
        default: false
    },
    offlineRemovals: {
        type: OptionType.BOOLEAN,
        description: "Check for removals that happened while offline",
        default: true
    },
    friends: {
        type: OptionType.BOOLEAN,
        description: "Track when friends remove you",
        default: true
    },
    friendRequestCancels: {
        type: OptionType.BOOLEAN,
        description: "Track when friend requests are cancelled",
        default: true
    },
    servers: {
        type: OptionType.BOOLEAN,
        description: "Track when removed from servers",
        default: true
    },
    groups: {
        type: OptionType.BOOLEAN,
        description: "Track when removed from group chats",
        default: true
    },
    logKeybind: {
        type: OptionType.STRING,
        description: "Keybind to open relationship log (e.g., 'alt+o', 'ctrl+shift+r')",
        default: "alt+o"
    },
    maxLogEntries: {
        type: OptionType.NUMBER,
        description: "Maximum number of log entries to keep (0 = unlimited)",
        default: 100
    }
});

// Stores and data
const GuildAvailabilityStore = findStoreLazy("GuildAvailabilityStore") as FluxStore & {
    totalGuilds: number;
    totalUnavailableGuilds: number;
    unavailableGuilds: string[];
    isUnavailable(guildId: string): boolean;
};

const guilds = new Map<string, SimpleGuild>();
const groups = new Map<string, SimpleGroupChannel>();
const friends = {
    friends: [] as string[],
    requests: [] as string[]
};

let relationshipLog: RelationshipLogEntry[] = [];
let manuallyRemovedFriend: string | undefined;
let manuallyRemovedGuild: string | undefined;
let manuallyRemovedGroup: string | undefined;

// Utility functions
const guildsKey = () => `relationship-notifier-guilds-${UserStore.getCurrentUser().id}`;
const groupsKey = () => `relationship-notifier-groups-${UserStore.getCurrentUser().id}`;
const friendsKey = () => `relationship-notifier-friends-${UserStore.getCurrentUser().id}`;
const logKey = () => `relationship-notifier-log-${UserStore.getCurrentUser().id}`;

async function addLogEntry(entry: Omit<RelationshipLogEntry, 'timestamp'>) {
    const newEntry: RelationshipLogEntry = {
        ...entry,
        timestamp: Date.now()
    };

    relationshipLog.unshift(newEntry);

    if (settings.store.maxLogEntries > 0 && relationshipLog.length > settings.store.maxLogEntries) {
        relationshipLog = relationshipLog.slice(0, settings.store.maxLogEntries);
    }

    await DataStore.set(logKey(), relationshipLog);
}

async function loadLog() {
    const log = await DataStore.get(logKey()) as RelationshipLogEntry[] | undefined;
    relationshipLog = log || [];
}

function notify(text: string, icon?: string, onClick?: () => void, logEntry?: Omit<RelationshipLogEntry, 'timestamp'>) {
    if (logEntry) {
        addLogEntry(logEntry);
    }

    if (settings.store.showNotices)
        Notices.showNotice(text, "OK", () => Notices.popNotice());

    if (settings.store.showNotifications)
        showNotification({
            title: "Relationship Notifier",
            body: text,
            icon,
            onClick
        });
}

async function runMigrations() {
    DataStore.delMany(["relationship-notifier-guilds", "relationship-notifier-groups", "relationship-notifier-friends"]);
}

export async function syncAndRunChecks() {
    await runMigrations();
    await loadLog();

    if (UserStore.getCurrentUser() == null) return;

    const [oldGuilds, oldGroups, oldFriends] = await DataStore.getMany([
        guildsKey(),
        groupsKey(),
        friendsKey()
    ]) as [Map<string, SimpleGuild> | undefined, Map<string, SimpleGroupChannel> | undefined, Record<"friends" | "requests", string[]> | undefined];

    await Promise.all([syncGuilds(), syncGroups(), syncFriends()]);

    if (settings.store.offlineRemovals) {
        if (settings.store.groups && oldGroups?.size) {
            for (const [id, group] of oldGroups) {
                if (!groups.has(id)) {
                    notify(
                        `You are no longer in the group ${group.name}.`,
                        group.iconURL,
                        undefined,
                        {
                            id,
                            type: 'group',
                            name: group.name,
                            iconURL: group.iconURL
                        }
                    );
                }
            }
        }

        if (settings.store.servers && oldGuilds?.size) {
            for (const [id, guild] of oldGuilds) {
                if (!guilds.has(id) && !GuildAvailabilityStore.isUnavailable(id)) {
                    notify(
                        `You are no longer in the server ${guild.name}.`,
                        guild.iconURL,
                        undefined,
                        {
                            id,
                            type: 'server',
                            name: guild.name,
                            iconURL: guild.iconURL
                        }
                    );
                }
            }
        }

        if (settings.store.friends && oldFriends?.friends.length) {
            for (const id of oldFriends.friends) {
                if (friends.friends.includes(id)) continue;

                const user = await UserUtils.getUser(id).catch(() => void 0);
                if (user) {
                    const username = getUniqueUsername(user);
                    notify(
                        `You are no longer friends with ${username}.`,
                        user.getAvatarURL(undefined, undefined, false),
                        () => openUserProfile(user.id),
                        {
                            id,
                            type: 'friend',
                            name: username,
                            iconURL: user.getAvatarURL(undefined, undefined, false),
                            userId: id
                        }
                    );
                }
            }
        }

        if (settings.store.friendRequestCancels && oldFriends?.requests?.length) {
            for (const id of oldFriends.requests) {
                if (
                    friends.requests.includes(id) ||
                    [RelationshipType.FRIEND, RelationshipType.BLOCKED, RelationshipType.OUTGOING_REQUEST].includes(RelationshipStore.getRelationshipType(id))
                ) continue;

                const user = await UserUtils.getUser(id).catch(() => void 0);
                if (user) {
                    const username = getUniqueUsername(user);
                    notify(
                        `Friend request from ${username} has been revoked.`,
                        user.getAvatarURL(undefined, undefined, false),
                        () => openUserProfile(user.id),
                        {
                            id,
                            type: 'friendRequest',
                            name: username,
                            iconURL: user.getAvatarURL(undefined, undefined, false),
                            userId: id
                        }
                    );
                }
            }
        }
    }
}

function getGuild(id: string) {
    return guilds.get(id);
}

function deleteGuild(id: string) {
    guilds.delete(id);
    syncGuilds();
}

async function syncGuilds() {
    guilds.clear();

    const me = UserStore.getCurrentUser().id;
    for (const [id, { name, icon }] of Object.entries(GuildStore.getGuilds())) {
        if (GuildMemberStore.isMember(id, me))
            guilds.set(id, {
                id,
                name,
                iconURL: icon && `https://cdn.discordapp.com/icons/${id}/${icon}.png`
            });
    }
    await DataStore.set(guildsKey(), guilds);
}

function getGroup(id: string) {
    return groups.get(id);
}

function deleteGroup(id: string) {
    groups.delete(id);
    syncGroups();
}

async function syncGroups() {
    groups.clear();

    for (const { type, id, name, rawRecipients, icon } of ChannelStore.getSortedPrivateChannels()) {
        if (type === ChannelType.GROUP_DM)
            groups.set(id, {
                id,
                name: name || rawRecipients.map(r => r.username).join(", "),
                iconURL: icon && `https://cdn.discordapp.com/channel-icons/${id}/${icon}.png`
            });
    }

    await DataStore.set(groupsKey(), groups);
}

async function syncFriends() {
    friends.friends = [];
    friends.requests = [];

    const relationShips = RelationshipStore.getMutableRelationships();
    for (const [id, type] of relationShips) {
        switch (type) {
            case RelationshipType.FRIEND:
                friends.friends.push(id);
                break;
            case RelationshipType.INCOMING_REQUEST:
                friends.requests.push(id);
                break;
        }
    }

    await DataStore.set(friendsKey(), friends);
}

// Event handlers
const removeFriend = (id: string) => manuallyRemovedFriend = id;
const removeGuild = (id: string) => manuallyRemovedGuild = id;
const removeGroup = (id: string) => manuallyRemovedGroup = id;

async function onRelationshipRemove({ relationship: { type, id } }: RelationshipRemove) {
    if (manuallyRemovedFriend === id) {
        manuallyRemovedFriend = undefined;
        return;
    }

    const user = await UserUtils.getUser(id).catch(() => null);
    if (!user) return;

    const username = getUniqueUsername(user);
    const avatarURL = user.getAvatarURL(undefined, undefined, false);
    const onClick = () => openUserProfile(user.id);

    switch (type) {
        case RelationshipType.FRIEND:
            if (settings.store.friends) {
                notify(
                    `${username} removed you as a friend.`,
                    avatarURL,
                    onClick,
                    {
                        id,
                        type: 'friend',
                        name: username,
                        iconURL: avatarURL,
                        userId: id
                    }
                );
            }
            break;
        case RelationshipType.INCOMING_REQUEST:
            if (settings.store.friendRequestCancels) {
                notify(
                    `A friend request from ${username} has been removed.`,
                    avatarURL,
                    onClick,
                    {
                        id,
                        type: 'friendRequest',
                        name: username,
                        iconURL: avatarURL,
                        userId: id
                    }
                );
            }
            break;
    }
}

function onGuildDelete({ guild: { id, unavailable } }: GuildDelete) {
    if (!settings.store.servers) return;
    if (unavailable || GuildAvailabilityStore.isUnavailable(id)) return;

    if (manuallyRemovedGuild === id) {
        deleteGuild(id);
        manuallyRemovedGuild = undefined;
        return;
    }

    const guild = getGuild(id);
    if (guild) {
        deleteGuild(id);
        notify(
            `You were removed from the server ${guild.name}.`,
            guild.iconURL,
            undefined,
            {
                id,
                type: 'server',
                name: guild.name,
                iconURL: guild.iconURL
            }
        );
    }
}

function onChannelDelete({ channel: { id, type } }: ChannelDelete) {
    if (!settings.store.groups) return;
    if (type !== ChannelType.GROUP_DM) return;

    if (manuallyRemovedGroup === id) {
        deleteGroup(id);
        manuallyRemovedGroup = undefined;
        return;
    }

    const group = getGroup(id);
    if (group) {
        deleteGroup(id);
        notify(
            `You were removed from the group ${group.name}.`,
            group.iconURL,
            undefined,
            {
                id,
                type: 'group',
                name: group.name,
                iconURL: group.iconURL
            }
        );
    }
}

// Modal Component
function RelationshipLogModal({ modalProps }: { modalProps: ModalProps }) {
    const [searchQuery, setSearchQuery] = React.useState("");
    const [logEntries, setLogEntries] = React.useState([...relationshipLog]);
    const [filteredLog, setFilteredLog] = React.useState([...relationshipLog]);

    // Update local state when relationshipLog changes
    React.useEffect(() => {
        setLogEntries([...relationshipLog]);
    }, [relationshipLog.length]); // Using length as dependency to detect changes

    // Filter entries based on search query
    React.useEffect(() => {
        if (!searchQuery.trim()) {
            setFilteredLog([...logEntries]);
        } else {
            const query = searchQuery.toLowerCase().trim();
            setFilteredLog(logEntries.filter(entry =>
                entry.name.toLowerCase().includes(query)
            ));
        }
    }, [searchQuery, logEntries]);

    const clearLog = React.useCallback(async () => {
        try {
            relationshipLog.length = 0; // Clear the global array
            await DataStore.set(logKey(), []);
            setLogEntries([]);
            setFilteredLog([]);
        } catch (error) {
            console.error("Failed to clear log:", error);
        }
    }, []);

    const handleSearchChange = React.useCallback((value: string) => {
        setSearchQuery(value);
    }, []);

    const formatDate = React.useCallback((timestamp: number) => {
        return new Date(timestamp).toLocaleString();
    }, []);

    const getTypeColor = React.useCallback((type: string) => {
        switch (type) {
            case 'friend': return 'var(--red-400)';
            case 'server': return 'var(--blue-400)';
            case 'group': return 'var(--green-400)';
            case 'friendRequest': return 'var(--yellow-400)';
            default: return 'var(--text-normal)';
        }
    }, []);

    const getTypeIcon = React.useCallback((type: string) => {
        switch (type) {
            case 'friend': return '👤';
            case 'server': return '🏠';
            case 'group': return '👥';
            case 'friendRequest': return '📨';
            default: return '❓';
        }
    }, []);

    const handleEntryClick = React.useCallback((userId?: string) => {
        if (userId) {
            openUserProfile(userId);
        }
    }, []);

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE}>
            <ModalHeader>
                <Forms.FormTitle tag="h4">Relationship Log</Forms.FormTitle>
            </ModalHeader>

            <ModalContent>
                <Forms.FormText type={Forms.FormText.Types.DESCRIPTION} style={{ marginBottom: "16px" }}>
                    Track who has removed you from friends, servers, and groups.
                </Forms.FormText>

                <Flex style={{ marginBottom: "16px", gap: "8px" }}>
                    <TextInput
                        placeholder="Search by name..."
                        value={searchQuery}
                        onChange={handleSearchChange}
                        style={{ flex: 1 }}
                    />
                    <Button
                        color={Button.Colors.RED}
                        onClick={clearLog}
                        disabled={logEntries.length === 0}
                    >
                        Clear Log
                    </Button>
                </Flex>

                <div style={{
                    maxHeight: "400px",
                    overflowY: "auto",
                    border: "1px solid var(--background-modifier-accent)",
                    borderRadius: "4px"
                }}>
                    {filteredLog.length === 0 ? (
                        <div style={{
                            padding: "32px",
                            textAlign: "center",
                            color: "var(--text-muted)"
                        }}>
                            {logEntries.length === 0
                                ? "No relationship changes logged yet."
                                : searchQuery.trim()
                                    ? "No results found."
                                    : "No entries to display."
                            }
                        </div>
                    ) : (
                        filteredLog.map((entry, index) => (
                            <div
                                key={`${entry.id}-${entry.timestamp}-${index}`}
                                style={{
                                    padding: "12px 16px",
                                    borderBottom: index < filteredLog.length - 1 ? "1px solid var(--background-modifier-accent)" : "none",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "12px",
                                    cursor: entry.userId ? "pointer" : "default",
                                    transition: "background-color 0.1s ease"
                                }}
                                onClick={() => handleEntryClick(entry.userId)}
                                onMouseEnter={(e) => {
                                    if (entry.userId) {
                                        e.currentTarget.style.backgroundColor = "var(--background-modifier-hover)";
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = "transparent";
                                }}
                            >
                                <div style={{ fontSize: "20px", flexShrink: 0 }}>
                                    {entry.iconURL ? (
                                        <img
                                            src={entry.iconURL}
                                            alt=""
                                            style={{
                                                width: "32px",
                                                height: "32px",
                                                borderRadius: entry.type === 'friend' || entry.type === 'friendRequest' ? "50%" : "4px",
                                                objectFit: "cover"
                                            }}
                                            onError={(e) => {
                                                // Fallback to emoji if image fails to load
                                                const target = e.target as HTMLImageElement;
                                                const parent = target.parentElement;
                                                if (parent) {
                                                    parent.innerHTML = getTypeIcon(entry.type);
                                                }
                                            }}
                                        />
                                    ) : (
                                        <span>{getTypeIcon(entry.type)}</span>
                                    )}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "8px",
                                        marginBottom: "4px",
                                        flexWrap: "wrap"
                                    }}>
                                        <Text style={{
                                            fontWeight: "600",
                                            wordBreak: "break-word",
                                            flex: "1 1 auto"
                                        }}>
                                            {entry.name}
                                        </Text>
                                        <Text
                                            style={{
                                                fontSize: "12px",
                                                padding: "2px 6px",
                                                borderRadius: "4px",
                                                backgroundColor: getTypeColor(entry.type),
                                                color: "white",
                                                textTransform: "capitalize",
                                                flexShrink: 0,
                                                whiteSpace: "nowrap"
                                            }}
                                        >
                                            {entry.type === 'friendRequest' ? 'Friend Request' : entry.type}
                                        </Text>
                                    </div>
                                    <Text style={{
                                        fontSize: "12px",
                                        color: "var(--text-muted)"
                                    }}>
                                        {formatDate(entry.timestamp)}
                                    </Text>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {logEntries.length > 0 && (
                    <div style={{
                        marginTop: "12px",
                        fontSize: "12px",
                        color: "var(--text-muted)",
                        textAlign: "center"
                    }}>
                        {filteredLog.length === logEntries.length
                            ? `${logEntries.length} total entries`
                            : `${filteredLog.length} of ${logEntries.length} entries`
                        }
                    </div>
                )}
            </ModalContent>

            <ModalFooter>
                <Button
                    color={Button.Colors.GREEN}
                    onClick={modalProps.onClose}
                >
                    Close
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

// Keybind handler
function setupKeybind() {
    const keybind = settings.store.logKeybind.toLowerCase();

    const handleKeyDown = (event: KeyboardEvent) => {
        const keys = keybind.split('+').map(k => k.trim());

        let matches = true;

        if (keys.includes('ctrl') && !event.ctrlKey) matches = false;
        if (keys.includes('alt') && !event.altKey) matches = false;
        if (keys.includes('shift') && !event.shiftKey) matches = false;
        if (keys.includes('meta') && !event.metaKey) matches = false;

        const mainKey = keys.find(k => !['ctrl', 'alt', 'shift', 'meta'].includes(k));
        if (mainKey && event.key.toLowerCase() !== mainKey) matches = false;

        if (matches) {
            event.preventDefault();
            openModal(modalProps => <RelationshipLogModal modalProps={modalProps} />);
        }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
        document.removeEventListener('keydown', handleKeyDown);
    };
}

// Plugin definition
export default definePlugin({
    name: "whoRemovedMe",
    description: "Enhanced friendship notifier with log tracking and modal interface. Press Alt+O (or your custom keybind) to view friendship changes.",
    authors: [{
        name: "curve",
        id: 818846027511103508n
    }],
    settings,

    patches: [
        {
            find: "removeRelationship:(",
            replacement: {
                match: /(removeRelationship:\((\i),\i,\i\)=>)/,
                replace: "$1($self.removeFriend($2),0)||"
            }
        },
        {
            find: "async leaveGuild(",
            replacement: {
                match: /(leaveGuild\((\i)\){)/,
                replace: "$1$self.removeGuild($2);"
            }
        },
        {
            find: "},closePrivateChannel(",
            replacement: {
                match: /(closePrivateChannel\((\i)\){)/,
                replace: "$1$self.removeGroup($2);"
            }
        }
    ],

    flux: {
        GUILD_CREATE: syncGuilds,
        GUILD_DELETE: onGuildDelete,
        CHANNEL_CREATE: syncGroups,
        CHANNEL_DELETE: onChannelDelete,
        RELATIONSHIP_ADD: syncFriends,
        RELATIONSHIP_UPDATE: syncFriends,
        RELATIONSHIP_REMOVE(e) {
            onRelationshipRemove(e);
            syncFriends();
        },
        CONNECTION_OPEN: syncAndRunChecks
    },

    keybindCleanup: undefined as (() => void) | undefined,

    async start() {
        setTimeout(() => {
            syncAndRunChecks();
        }, 5000);

        this.keybindCleanup = setupKeybind();
    },

    stop() {
        this.keybindCleanup?.();
    },

    removeFriend,
    removeGroup,
    removeGuild
});
