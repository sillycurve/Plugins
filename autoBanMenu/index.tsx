import { ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, ModalSize, openModal } from "@utils/modal";
import { React, Text } from "@webpack/common";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, UserStore, useState, useEffect } from "@webpack/common";
import { Util } from "Vencord";
import { Constants, RestAPI } from "@webpack/common";
import { Button, TextInput } from "@webpack/common";

const settings = definePluginSettings({
    githubToken: {
        description: "GitHub Personal Access Token (with gist permissions)",
        type: OptionType.STRING,
        default: "",
        placeholder: "ghp_xxxxxxxxxxxxxxxxxxxx"
    },
    githubGistId: {
        description: "Shared GitHub Gist ID for ban list sync",
        type: OptionType.STRING,
        default: "",
        placeholder: "1234567890abcdef1234567890abcdef"
    },
    githubUsername: {
        description: "Your identifier (curve, dot, or wowza)",
        type: OptionType.STRING,
        default: "",
        placeholder: "curve"
    },
    enableAutoSync: {
        description: "Auto-sync ban list every 5 minutes",
        type: OptionType.BOOLEAN,
        default: false
    }
});

export function openGuildInfoModal() {
    openModal(modalProps => <BanListManager modalProps={modalProps} />);
}

// Get GitHub config from plugin settings
function getGithubConfig() {
    return {
        token: settings.store.githubToken || "",
        gistId: settings.store.githubGistId || "",
        username: settings.store.githubUsername || "Unknown"
    };
}

// Sync to GitHub Gist
async function syncToGist(pluginName: string, usersKey: string) {
    const config = getGithubConfig();
    if (!config.token || !config.gistId) {
        alert('Configure GitHub token and Gist ID in plugin settings first.');
        return;
    }

    try {
        const plugin = Vencord.Plugins.plugins[pluginName];
        const userString = plugin.settings.store[usersKey] || "";
        const userList = userString.split('/').filter(Boolean);

        const exportData = {
            plugin: pluginName,
            lastUpdated: new Date().toISOString(),
            updatedBy: config.username,
            users: userList
        };

        const response = await fetch(`https://api.github.com/gists/${config.gistId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `token ${config.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                files: {
                    [`${pluginName}-banlist.json`]: {
                        content: JSON.stringify(exportData, null, 2)
                    }
                }
            })
        });

        if (response.ok) {
            alert(`Synced ${userList.length} users to shared ban list!`);
        } else {
            throw new Error(`GitHub API error: ${response.status}`);
        }
    } catch (error) {
        console.error('Sync failed:', error);
        alert(`Failed to sync: ${error.message}`);
    }
}

// Sync from GitHub Gist
async function syncFromGist(pluginName: string, usersKey: string, onUpdate: () => void) {
    const config = getGithubConfig();
    if (!config.token || !config.gistId) {
        alert('Configure GitHub token and Gist ID in plugin settings first.');
        return;
    }

    try {
        const response = await fetch(`https://api.github.com/gists/${config.gistId}`, {
            headers: {
                'Authorization': `token ${config.token}`,
                'Accept': 'application/vnd.github.v3+json',
            }
        });

        if (!response.ok) {
            throw new Error(`GitHub API error: ${response.status}`);
        }

        const gistData = await response.json();
        const fileName = `${pluginName}-banlist.json`;

        if (!gistData.files[fileName]) {
            alert('No shared ban list found for this plugin.');
            return;
        }

        const importData = JSON.parse(gistData.files[fileName].content);
        const plugin = Vencord.Plugins.plugins[pluginName];

        const existingUsers = (plugin.settings.store[usersKey] || "").split('/').filter(Boolean);
        const mergedUsers = [...new Set([...existingUsers, ...importData.users])];

        plugin.settings.store[usersKey] = mergedUsers.join('/');

        const newCount = importData.users.filter(u => !existingUsers.includes(u)).length;
        const lastUpdated = new Date(importData.lastUpdated).toLocaleString();

        alert(`Sync complete!\nNew users: ${newCount}\nLast updated: ${lastUpdated}\nBy: ${importData.updatedBy}`);
        onUpdate();

    } catch (error) {
        console.error('Sync failed:', error);
        alert(`Failed to sync: ${error.message}`);
    }
}

// Auto-sync every 5 minutes
let autoSyncInterval: NodeJS.Timeout | null = null;

function startAutoSync(pluginName: string, usersKey: string, onUpdate: () => void) {
    if (!settings.store.enableAutoSync) return;

    if (autoSyncInterval) clearInterval(autoSyncInterval);
    autoSyncInterval = setInterval(() => {
        syncFromGist(pluginName, usersKey, onUpdate);
    }, 5 * 60 * 1000);
}

function stopAutoSync() {
    if (autoSyncInterval) {
        clearInterval(autoSyncInterval);
        autoSyncInterval = null;
    }
}

// Ban list component
function BanList({ pluginName, usersKey, title }: { pluginName: string; usersKey: string; title: string }) {
    const [users, setUsers] = useState<string[]>([]);
    const [userMap, setUserMap] = useState<Record<string, any>>({});
    const [searchTerm, setSearchTerm] = useState("");
    const [updateTrigger, setUpdateTrigger] = useState(0);

    const plugin = Vencord.Plugins.plugins[pluginName];
    const triggerUpdate = () => setUpdateTrigger(prev => prev + 1);

    // Load users from plugin settings
    useEffect(() => {
        if (!plugin?.settings?.store) return;
        const userString = plugin.settings.store[usersKey] || "";
        setUsers(userString.split('/').filter(Boolean));
    }, [plugin, usersKey, updateTrigger]);

    // Start auto-sync
    useEffect(() => {
        startAutoSync(pluginName, usersKey, triggerUpdate);
        return () => stopAutoSync();
    }, []);

    // Fetch user data
    useEffect(() => {
        users.forEach(async (id) => {
            if (!userMap[id]) {
                let user = UserStore.getUser(id);
                if (!user) {
                    try {
                        const response = await RestAPI.get({ url: Constants.Endpoints.USER(id) });
                        FluxDispatcher.dispatch({ type: "USER_UPDATE", user: response.body });
                        user = UserStore.getUser(id);
                    } catch (error) {
                        console.warn(`Failed to fetch user ${id}:`, error);
                    }
                }
                if (user) {
                    setUserMap(prev => ({ ...prev, [id]: user }));
                }
            }
        });
    }, [users]);

    const filteredUsers = users.filter(id => {
        if (!searchTerm.trim()) return true;
        const user = userMap[id];
        const search = searchTerm.toLowerCase();
        return user?.username?.toLowerCase().includes(search) ||
               user?.globalName?.toLowerCase().includes(search) ||
               id.includes(searchTerm);
    });

    const removeUser = (id: string) => {
        const newUsers = users.filter(uid => uid !== id);
        plugin.settings.store[usersKey] = newUsers.join('/');
        setUsers(newUsers);
    };

    return (
        <div style={{ padding: "20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                <Text variant="heading-lg/semibold" style={{ color: "white" }}>
                    {title} ({users.length} users)
                </Text>

                <div style={{ display: "flex", gap: "8px" }}>
                    <Button size="small" color="green" onClick={() => syncFromGist(pluginName, usersKey, triggerUpdate)}>
                        Sync Down
                    </Button>
                    <Button size="small" color="blurple" onClick={() => syncToGist(pluginName, usersKey)}>
                        Sync Up
                    </Button>
                </div>
            </div>

            <TextInput
                value={searchTerm}
                onChange={setSearchTerm}
                placeholder="Search users..."
                style={{ width: "100%", marginBottom: "16px" }}
            />

            <div style={{ maxHeight: "400px", overflowY: "auto" }}>
                {filteredUsers.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
                        {users.length === 0 ? "No users in ban list" : `No users matching "${searchTerm}"`}
                    </div>
                ) : (
                    filteredUsers.map((id, index) => {
                        const user = userMap[id];
                        return (
                            <div key={id} style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "12px",
                                padding: "12px",
                                marginBottom: "8px",
                                backgroundColor: "var(--background-primary)",
                                borderRadius: "8px"
                            }}>
                                <div style={{
                                    minWidth: "30px",
                                    height: "30px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    backgroundColor: "var(--brand-experiment)",
                                    color: "white",
                                    borderRadius: "50%",
                                    fontSize: "12px",
                                    fontWeight: "bold"
                                }}>
                                    {index + 1}
                                </div>

                                <img
                                    onClick={() => Util.openUserProfile(id)}
                                    src={user?.getAvatarURL?.() ?? "https://cdn.discordapp.com/embed/avatars/0.png"}
                                    style={{ width: "40px", height: "40px", borderRadius: "50%", cursor: "pointer" }}
                                />

                                <div style={{ flex: 1 }}>
                                    <div style={{ color: "white", fontWeight: "600" }}>
                                        {user?.username || "Unknown User"}
                                    </div>
                                    {user?.globalName && user.globalName !== user.username && (
                                        <div style={{ fontSize: "14px", color: "var(--text-muted)" }}>
                                            {user.globalName}
                                        </div>
                                    )}
                                    <div style={{ fontSize: "12px", color: "var(--text-muted)", fontFamily: "monospace" }}>
                                        {id}
                                    </div>
                                </div>

                                <Button onClick={() => removeUser(id)} size="small" color="red">
                                    Remove
                                </Button>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}

// Main modal
function BanListManager({ modalProps }: { modalProps: ModalProps }) {
    const [activeTab, setActiveTab] = useState<'single' | 'multi'>('single');

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE}>
            <ModalHeader>
                <Text variant="heading-lg/semibold" style={{ color: "white" }}>
                    Auto-Ban List Management
                </Text>
            </ModalHeader>

            <ModalContent style={{ padding: "0" }}>
                <div style={{ display: "flex", borderBottom: "1px solid var(--background-modifier-accent)" }}>
                    <button
                        style={{
                            padding: "12px 24px",
                            backgroundColor: activeTab === 'single' ? "var(--brand-experiment)" : "var(--background-secondary)",
                            color: "white",
                            border: "none",
                            cursor: "pointer"
                        }}
                        onClick={() => setActiveTab('single')}
                    >
                        Dadscord
                    </button>
                    <button
                        style={{
                            padding: "12px 24px",
                            backgroundColor: activeTab === 'multi' ? "var(--brand-experiment)" : "var(--background-secondary)",
                            color: "white",
                            border: "none",
                            cursor: "pointer"
                        }}
                        onClick={() => setActiveTab('multi')}
                    >
                        Multi Server
                    </button>
                </div>

                {activeTab === 'single' ? (
                    <BanList pluginName="autoBan" usersKey="users" title="Dadscord Bans" />
                ) : (
                    <BanList pluginName="MultiServerAutoban" usersKey="users" title="Multi Server Bans" />
                )}
            </ModalContent>

            <ModalFooter>
                <Button color="red" onClick={modalProps.onClose}>
                    Close
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

function handleKeydown(e: KeyboardEvent) {
    if (e.altKey && e.key.toLowerCase() === "j") {
        openGuildInfoModal();
    }
}

export default definePlugin({
    name: "autoBanMenu",
    description: "Auto-ban menu with gitHub sync for sharing between users.",
    authors: [{ name: "curve", id: 818846027511103508n }, { name: "dot", id: 1400606596521791773n }],

    settings,

    start() {
        document.addEventListener("keydown", handleKeydown);
    },

    stop() {
        document.removeEventListener("keydown", handleKeydown);
        stopAutoSync();
    },
});
