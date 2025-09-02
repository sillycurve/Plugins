import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy, findByCodeLazy, } from "@webpack";
import { Button, React, TextInput, Flex, Forms, Toasts, Menu, Select, UserStore, ChannelStore, RestAPI, GuildStore } from "@webpack/common";
import { ModalContent, ModalFooter, ModalHeader, ModalProps, ModalSize, ModalRoot, openModal } from "@utils/modal";
import ErrorBoundary from "@components/ErrorBoundary";
import { classes } from "@utils/misc";
import { findStoreLazy, } from "@webpack";
import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { getUserSettingLazy } from "@api/UserSettings";
import { Devs } from "@utils/constants";
import { findComponentByCodeLazy } from "@webpack";

const Button2 = findComponentByCodeLazy(".NONE,disabled:", ".PANEL_BUTTON");
const InputStyles = findByPropsLazy("inputDefault", "inputWrapper");
const VoiceStateStore = findStoreLazy("VoiceStateStore");
const vc = findByPropsLazy("getVoiceChannelId");

const sessionStore = findByPropsLazy("getSessionId");
const settings = definePluginSettings({
    commands: {
        description: "commands data",
        type: OptionType.STRING,
        default: "",
    },
    isautomatic: {
        description: "do not touch unless u know what u doing",
        type: OptionType.BOOLEAN,
        default: true,
    },
});


function Kbind(e: KeyboardEvent) {
    if (e.altKey && e.key.toLowerCase() === 'c') {
        openModal(modalProps => <EncModals modalProps={modalProps} />)
    }
}


export default definePlugin({
    name: "contextMenu",
    description: "Adds an option to ban people from custom vcs",
    authors: [{ name: "curve", id: 818846027511103508n }, { name: "dot", id: 1400606596521791773n }],
    dependencies: ["UserSettingsAPI"],
    settings,
    contextMenus: { "rtc-channel": ChannelMakeContextMenuPatch("rtc-channel"), "user-context": makeContextMenuPatch(), "channel-context": ChannelMakeContextMenuPatch("channel-context") },
    start() {
        document.addEventListener('keydown', Kbind);
    },
    stop() {
        document.removeEventListener('keydown', Kbind);
    }
});


interface commands {
    name: string;
    channelID: string;
    type: string;
    serverId?: string; // Add server ID to interface
}

const types = [
    { label: "User", value: "user", default: true },
    { label: "Channel", value: "channel", default: false },
];

function EncModals({ modalProps }: { modalProps: ModalProps }) {
    const [Commands, setCommands] = React.useState(isValidJson(settings.store.commands) as commands[]);
    const [newCommand, setnewCommand] = React.useState("");
    const [channelID, setchannelID] = React.useState("");
    const [type, setType] = React.useState("user");
    const [selectedServerId, setSelectedServerId] = React.useState(""); // Add server state
    const [availableServers, setAvailableServers] = React.useState([]); // Add servers state

    // Load available servers on mount
    React.useEffect(() => {
        loadAvailableServers();
    }, []);

    const loadAvailableServers = () => {
        try {
            const guilds = GuildStore.getGuilds();
            if (!guilds) {
                setAvailableServers([]);
                return;
            }

            const serverList = Object.values(guilds)
                .filter((guild: any) => guild && guild.id && guild.name)
                .map((guild: any) => ({
                    label: guild.name,
                    value: guild.id,
                    default: false
                }))
                .sort((a, b) => a.label.localeCompare(b.label));

            setAvailableServers(serverList);
        } catch (e) {
            console.error("[Context Commands] Error loading servers:", e);
            setAvailableServers([]);
        }
    };

    return (
        <ModalRoot {...modalProps} size={ModalSize.LARGE}>
            <ModalHeader>
                <svg width="20" height="20" viewBox="0 0 24 24" style={{ marginRight: "10px" }}>
                    <g fill={"#b5bac1"}>
                        <path d="M23.629,14.25c-.414-.719-1.332-.965-2.049-.549l-.676,.39c-.412-.352-.884-.629-1.404-.815v-.776c0-.829-.672-1.5-1.5-1.5s-1.5,.671-1.5,1.5v.776c-.521,.186-.992,.463-1.404,.815l-.676-.39c-.717-.414-1.635-.17-2.049,.549-.414,.718-.168,1.635,.549,2.049l.663,.383c-.049,.266-.083,.538-.083,.819s.034,.552,.083,.819l-.663,.383c-.717,.414-.963,1.331-.549,2.049,.277,.481,.781,.75,1.3,.75,.255,0,.513-.064,.749-.201l.676-.39c.412,.352,.884,.629,1.404,.815v.776c0,.828,.672,1.5,1.5,1.5s1.5-.672,1.5-1.5v-.776c.521-.186,.992-.463,1.404-.815l.676,.39c.236,.137,.494,.201,.749,.201,.518,0,1.022-.269,1.3-.75,.414-.718,.168-1.635-.549-2.049l-.663-.383c.049-.266,.083-.538,.083-.819s-.034-.552-.083-.819l.663-.383c.717-.414,.963-1.331,.549-2.049Zm-5.629,4.75c-.827,0-1.5-.673-1.5-1.5s.673-1.5,1.5-1.5,1.5,.673,1.5,1.5-.673,1.5-1.5,1.5Zm6-11.5v2c0,.829-.672,1.5-1.5,1.5s-1.5-.671-1.5-1.5v-2c0-.171-.018-.338-.051-.5H3v9.5c0,1.379,1.121,2.5,2.5,2.5h3c.828,0,1.5,.672,1.5,1.5s-.672,1.5-1.5,1.5h-3c-3.032,0-5.5-2.468-5.5-5.5V5.5C0,2.467,2.468,0,5.5,0h2.528c.54,0,1.081,.128,1.564,.369l3.156,1.578c.068,.035,.146,.053,.223,.053h5.528c3.032,0,5.5,2.467,5.5,5.5Z" />
                    </g>
                </svg>
                <Forms.FormTitle tag="h4">Context Commands</Forms.FormTitle>
            </ModalHeader>

            <ModalContent>
                <Flex style={{ gap: "20px", marginTop: "10px", "flex-direction": "row", flex: "none", alignItems: "center" }}>
                    <Flex flexDirection="row" style={{ marginTop: "10px", marginBottom: "10px", justifyContent: "space-around", }}>
                        {/* Server dropdown - first field */}
                        <Flex style={{ justifyContent: "space-around", "flex-direction": "column", width: "25%" }}>
                            <Flex style={{ justifyContent: "flex-start", "flex-direction": "column", gap: "5px", marginLeft: "0px" }}>
                                <div className={InputStyles.inputWrapper}>
                                    <Select
                                        options={availableServers}
                                        serialize={String}
                                        select={(e) => setSelectedServerId(e)}
                                        isSelected={v => v === selectedServerId}
                                        closeOnSelect={true}
                                        placeholder="Select Server"
                                    />
                                </div>
                            </Flex>
                        </Flex>
                        <Flex style={{ justifyContent: "space-around", "flex-direction": "column", width: "30%" }}>
                            <Flex style={{ justifyContent: "flex-start", "flex-direction": "column", gap: "5px", marginLeft: "0px" }}>
                                <TextInput
                                    value={newCommand}
                                    placeholder="Command"
                                    draggable={true}
                                    maxLength={40}
                                    onChange={(e: string) => setnewCommand(e)}
                                />
                            </Flex>
                        </Flex>
                        <Flex style={{ justifyContent: "space-around", "flex-direction": "column", width: "30%" }}>
                            <Flex style={{ justifyContent: "flex-start", "flex-direction": "column", gap: "5px", marginLeft: "0px" }}>
                                <TextInput
                                    value={channelID}
                                    placeholder="Channel ID"
                                    draggable={true}
                                    onChange={(e: string) => setchannelID(e)}
                                />
                            </Flex>
                        </Flex>
                        <Flex style={{ justifyContent: "space-around", "flex-direction": "column", width: "15%" }}>
                            <div className={InputStyles.inputWrapper}>
                                <Select
                                    options={types}
                                    serialize={String}
                                    select={(e) => setType(e)}
                                    isSelected={v => v === type}
                                    closeOnSelect={true}
                                />
                            </div>
                        </Flex>
                    </Flex>

                    <Button2
                        onClick={() => {
                            const createdCommand: commands = {
                                name: newCommand,
                                channelID: channelID,
                                type: type,
                                serverId: selectedServerId
                            };
                            if (newCommand === "" || selectedServerId === "") return;
                            setCommands([...Commands, createdCommand]);
                            settings.store.commands = JSON.stringify([...Commands, createdCommand]);
                            setnewCommand("");
                            setchannelID("");
                            setSelectedServerId("");
                        }}
                        role="switch"
                        tooltipText={"Add Command"}
                        icon={
                            <svg width="20" height="20" viewBox="0 0 24 24">
                                <g fill={"#b5bac1"}>
                                    <path d="M23.629,14.25c-.414-.719-1.332-.965-2.049-.549l-.676,.39c-.412-.352-.884-.629-1.404-.815v-.776c0-.829-.672-1.5-1.5-1.5s-1.5,.671-1.5,1.5v.776c-.521,.186-.992,.463-1.404,.815l-.676-.39c-.717-.414-1.635-.17-2.049,.549-.414,.718-.168,1.635,.549,2.049l.663,.383c-.049,.266-.083,.538-.083,.819s.034,.552,.083,.819l-.663,.383c-.717,.414-.963,1.331-.549,2.049,.277,.481,.781,.75,1.3,.75,.255,0,.513-.064,.749-.201l.676-.39c.412,.352,.884,.629,1.404,.815v.776c0,.828,.672,1.5,1.5,1.5s1.5-.672,1.5-1.5v-.776c.521-.186,.992-.463,1.404-.815l.676,.39c.236,.137,.494,.201,.749,.201,.518,0,1.022-.269,1.3-.75,.414-.718,.168-1.635-.549-2.049l-.663-.383c.049-.266,.083-.538,.083-.819s-.034-.552-.083-.819l.663-.383c.717-.414,.963-1.331,.549-2.049Zm-5.629,4.75c-.827,0-1.5-.673-1.5-1.5s.673-1.5,1.5-1.5,1.5,.673,1.5,1.5-.673,1.5-1.5,1.5Zm6-11.5v2c0,.829-.672,1.5-1.5,1.5s-1.5-.671-1.5-1.5v-2c0-.171-.018-.338-.051-.5H3v9.5c0,1.379,1.121,2.5,2.5,2.5h3c.828,0,1.5,.672,1.5,1.5s-.672,1.5-1.5,1.5h-3c-3.032,0-5.5-2.468-5.5-5.5V5.5C0,2.467,2.468,0,5.5,0h2.528c.54,0,1.081,.128,1.564,.369l3.156,1.578c.068,.035,.146,.053,.223,.053h5.528c3.032,0,5.5,2.467,5.5,5.5Z" />
                                </g>
                            </svg>
                        }
                    />
                    <Button2
                        id="command-switch"
                        tooltipText={"Select current vc (in all) made by atticus <3"}
                        label="Select current vc"
                        role="switch"
                        icon={
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                role="img"
                                width={"18"}
                                height={"18"}
                                viewBox={"0 0 24 24"}
                                style={{ scale: "1" }}
                            >
                                <path
                                    fill="currentColor"
                                    d="M6 11h1.5V9H6v2Zm2.5 2H10V7H8.5v6Zm2.75 2h1.5V5h-1.5v10ZM14 13h1.5V7H14v6Zm2.5-2H18V9h-1.5v2ZM2 22V4q0-.825.588-1.413T4 2h16q.825 0 1.413.588T22 4v12q0 .825-.588 1.413T20 18H6l-4 4Zm3.15-6H20V4H4v13.125L5.15 16ZM4 16V4v12Z" />
                            </svg>
                        }
                        onClick={() => {
                            if (!Vencord.Plugins.plugins.contextMenu.settings.store.isautomatic) {
                                Vencord.Plugins.plugins.contextMenu.settings.store.isautomatic = true;
                            } else {
                                Vencord.Plugins.plugins.contextMenu.settings.store.isautomatic = false;
                            }
                            const currentChannelId = vc.getVoiceChannelId();
                            Commands.forEach(command => {
                                command.channelID = currentChannelId
                            });
                            settings.store.commands = JSON.stringify(Commands);
                            setCommands(JSON.parse(settings.store.commands));
                        }}

                    />
                </Flex>

                <Flex className={classes("qualitySettingsContainer__8f353")} style={{ marginTop: "10px", marginBottom: "10px", justifyContent: "space-around", "flex-direction": "column" }}>
                    <Forms.FormTitle tag="h5" style={{ marginTop: "5px" }}>Current Commands</Forms.FormTitle>
                    {Commands.length !== 0 ? (Commands.map((task) => {
                        // Get server name for display
                        const getServerName = (serverId?: string) => {
                            if (!serverId) return "No Server";
                            try {
                                const guild = GuildStore.getGuild(serverId);
                                return guild ? guild.name : "Unknown Server";
                            } catch (e) {
                                return "Unknown Server";
                            }
                        };

                        return (
                            <Flex style={{ gap: "20px", "flex-direction": "row", flex: "none", alignItems: "center", marginLeft: "0px", marginRight: "0px", }}>
                                <Flex flexDirection="row" style={{ marginTop: "10px", marginBottom: "10px", justifyContent: "space-around", }}>
                                    {/* Server dropdown for existing commands */}
                                    <Flex style={{ justifyContent: "space-around", "flex-direction": "column", width: "25%" }}>
                                        <Flex style={{ justifyContent: "flex-start", "flex-direction": "column", gap: "5px", marginLeft: "0px" }}>
                                            <div className={InputStyles.inputWrapper}>
                                                <Select
                                                    options={availableServers}
                                                    serialize={String}
                                                    select={(e) => {
                                                        const Command = Commands.find(t => t.name === task.name);
                                                        if (Command) Command.serverId = e;
                                                        settings.store.commands = JSON.stringify(Commands);
                                                        setCommands(JSON.parse(settings.store.commands));
                                                    }}
                                                    isSelected={v => v === Commands.find(t => t.name === task.name)?.serverId}
                                                    closeOnSelect={true}
                                                    placeholder={getServerName(task.serverId)}
                                                />
                                            </div>
                                        </Flex>
                                    </Flex>
                                    <Flex style={{ justifyContent: "space-around", "flex-direction": "column", width: "30%" }}>
                                        <Flex style={{ justifyContent: "flex-start", "flex-direction": "column", gap: "5px", marginLeft: "0px" }}>
                                            <TextInput
                                                value={task.name}
                                                placeholder="Command"
                                                maxLength={40}
                                                onChange={(e: string) => {
                                                    const Command = Commands.find(t => t.name === task.name);
                                                    if (Command) Command.name = e;
                                                    settings.store.commands = JSON.stringify(Commands);
                                                    setCommands(JSON.parse(settings.store.commands));
                                                }}
                                            />
                                        </Flex>
                                    </Flex>
                                    <Flex style={{ justifyContent: "space-around", flexDirection: "column", width: "30%" }}>
                                        <Flex style={{ justifyContent: "flex-start", flexDirection: "column", gap: "5px", marginLeft: "0px" }}>
                                            <TextInput
                                                value={task.channelID}
                                                placeholder="Channel ID"
                                                disabled={Vencord.Plugins.plugins.contextMenu.settings.store.isautomatic}
                                                onChange={(e: string) => {
                                                    if (Vencord.Plugins.plugins.contextMenu.settings.store.isautomatic) {
                                                        console.log("disabled lol")
                                                    }
                                                    const Command = Commands.find(t => t.name === task.name);
                                                    if (Command) Command.channelID = e;
                                                    settings.store.commands = JSON.stringify(Commands);
                                                    setCommands(JSON.parse(settings.store.commands));
                                                }}
                                            />
                                        </Flex>
                                    </Flex>
                                    <Flex style={{ justifyContent: "space-around", "flex-direction": "column", width: "15%" }}>
                                        <div className={InputStyles.inputWrapper}>
                                            <Select
                                                options={types}
                                                serialize={String}
                                                select={(e) => {
                                                    const Command = Commands.find(t => t.name === task.name);
                                                    if (Command) Command.type = e;
                                                    settings.store.commands = JSON.stringify(Commands);
                                                    setCommands(JSON.parse(settings.store.commands));
                                                }}
                                                isSelected={v => v === Commands.find(t => t.name === task.name)?.type}
                                                closeOnSelect={true}
                                            />
                                        </div>
                                    </Flex>
                                </Flex>
                                <Button2
                                    onClick={() => {
                                        settings.store.commands = JSON.stringify(Commands.filter(t => t.name !== task.name));
                                        setCommands(JSON.parse(settings.store.commands));
                                    }}
                                    role="switch"
                                    tooltipText={"Remove Command"}
                                    icon={
                                        <svg
                                            role="img"
                                            width={"18"}
                                            height={"18"}
                                            viewBox={"0 0 24 24"}
                                            style={{ scale: "1" }}
                                        >
                                            <g fill={"var(--red-430)"}>
                                                <path d="M14.25 1c.41 0 .75.34.75.75V3h5.25c.41 0 .75.34.75.75v.5c0 .41-.34.75-.75.75H3.75A.75.75 0 0 1 3 4.25v-.5c0-.41.34-.75.75-.75H9V1.75c0-.41.34-.75.75-.75h4.5Z" />
                                                <path fill-rule="evenodd" d="M5.06 7a1 1 0 0 0-1 1.06l.76 12.13a3 3 0 0 0 3 2.81h8.36a3 3 0 0 0 3-2.81l.75-12.13a1 1 0 0 0-1-1.06H5.07ZM11 12a1 1 0 1 0-2 0v6a1 1 0 1 0 2 0v-6Zm3-1a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Z" />
                                            </g>
                                        </svg>
                                    }
                                />
                            </Flex>
                        )
                    })) : (null)}
                </Flex>


            </ModalContent>

            <ModalFooter>
                <Button
                    color={Button.Colors.GREEN}
                    disabled={false}
                    onClick={() => modalProps.onClose()}
                >
                    Save
                </Button>
                <Button
                    color={Button.Colors.TRANSPARENT}
                    look={Button.Looks.LINK}
                    style={{ left: 15, position: "absolute" }}
                    onClick={() => modalProps.onClose()}
                >
                    Cancel
                </Button>
            </ModalFooter>
        </ModalRoot >

    );
}

function isValidJson(data: string): boolean | [] {
    try { return JSON.parse(data); }
    catch (e) { return []; }
}

function ChannelMenuItem(guildId: string, id?: string) {
    if (UserStore.getCurrentUser().id === id) return;
    const { channelId } = VoiceStateStore.getVoiceStateForUser(UserStore.getCurrentUser().id) ?? {};
    const currentGuildId = ChannelStore.getChannel(channelId)?.guild_id;
    if (!currentGuildId) return;
    if (channelId !== id) return;

    const data = JSON.parse(settings.store.commands).filter(command =>
        command.type === "channel" &&
        (command.serverId === currentGuildId || (!command.serverId && guildId === currentGuildId)) // Support legacy commands without serverId
    );

    if (data.length === 0) return;
    return (
        <Menu.MenuItem
            id="commands"
            label="Context Commands"
            children=
            {data.length !== 0 ? data.map((Command) => (
                <Menu.MenuItem
                    id={Command.name}
                    label={Command.name}
                    action={async () => sendCommand(Command.channelID, Command.name)}
                />
            )) : <Menu.MenuItem
                id="Empty List"
                label="Empty"
                disabled={true}
            />}
        />
    );
}

function MenuItem(id: string) {
    if (UserStore.getCurrentUser().id === id) return;
    const { channelId } = VoiceStateStore.getVoiceStateForSession(UserStore.getCurrentUser().id, sessionStore.getSessionId());
    console.log(channelId);
    console.log(sessionStore.getSessionId());

    const guildId = ChannelStore.getChannel(channelId)?.guild_id;

    if (!guildId) return;
    const data = JSON.parse(settings.store.commands)
        .filter(command =>
            command.type === "user" &&
            (command.serverId === guildId || // Match by serverId
                (!command.serverId && ChannelStore.getChannel(command.channelID)?.guild_id === guildId)) // Fallback for legacy commands
        );

    if (data.length === 0) return;

    return (
        <Menu.MenuItem
            id="commands"
            label="Context Commands"
            children=
            {data.length !== 0 ? data.map((Command) => (
                <Menu.MenuItem
                    id={Command.name}
                    label={Command.name}
                    action={async () => {
                        sendCommand(Command.channelID, `${Command.name} ${id}`);
                    }}
                />
            )) : <Menu.MenuItem
                id="Empty List"
                label="Empty"
                disabled={true}
            />}
        />

    );

}
function makeContextMenuPatch(): NavContextMenuPatchCallback {
    return (children, props) => {
        if (!props) return;
        const contextCommands = MenuItem(props.user.id);
        if (!contextCommands) return;
        children.splice(-1, 0, <Menu.MenuGroup>{contextCommands}</Menu.MenuGroup>);
    };
}
function ChannelMakeContextMenuPatch(type: string): NavContextMenuPatchCallback {
    return (children, props) => {
        if (!props) return;
        var group: any = null;

        if (type === "channel-context") group = findGroupChildrenByChildId(["mute-channel", "unmute-channel"], children);
        else if (type === "rtc-channel") group = findGroupChildrenByChildId(["show-voice-states"], children);
        const contextCommands = ChannelMenuItem(props?.channel?.guild_id, props?.channel?.id);

        if (!contextCommands || !group) return;
        group.push(contextCommands);
    };
}
async function sendCommand(channelId, content) {
    RestAPI.post({
        url: `/channels/${channelId}/messages`,
        body: { content, nonce: (Math.floor(Math.random() * 10000000000000)) }
    });
    Toasts.show({
        message: content,
        id: "command-sent",
        type: Toasts.Type.SUCCESS,
        options: {
            position: Toasts.Position.BOTTOM,
        }
    });
}