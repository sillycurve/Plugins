import { useSettings } from "@api/Settings";
import { classNameFactory } from "@api/Styles";
import { ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, ModalSize, openModal } from "@utils/modal";
import { Button, Flex, Forms, React, Text, TextInput, useMemo, Switch } from "@webpack/common";
import Plugins from "~plugins";
import { ChangeList } from "@utils/ChangeList";
import { Alerts, Parser, Tooltip } from "@webpack/common";
import { JSX } from "react";

const cl = classNameFactory("atticus-plugins-");

// Custom PluginCard component
function PluginCard({ plugin, disabled, onRestartNeeded, onMouseEnter, onMouseLeave }) {
    const settings = useSettings();
    const pluginSettings = settings.plugins[plugin.name];
    const isEnabled = pluginSettings?.enabled ?? false;

    const togglePlugin = React.useCallback(() => {
        const wasEnabled = pluginSettings?.enabled ?? false;
        settings.plugins[plugin.name] = {
            ...pluginSettings,
            enabled: !wasEnabled
        };
        
        if (onRestartNeeded) {
            onRestartNeeded(plugin.name);
        }
    }, [plugin.name, pluginSettings, onRestartNeeded]);

    return (
        <div 
            className={cl("plugin-card")}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            style={{
                padding: "16px",
                border: "1px solid var(--background-modifier-accent)",
                borderRadius: "8px",
                marginBottom: "8px",
                opacity: disabled ? 0.6 : 1,
                backgroundColor: "var(--background-secondary)"
            }}
        >
            <Flex direction={Flex.Direction.HORIZONTAL} justify={Flex.Justify.BETWEEN} align={Flex.Align.CENTER}>
                <div style={{ flex: 1 }}>
                    <Text variant="heading-md/semibold">{plugin.name}</Text>
                    {plugin.description && (
                        <Text variant="text-sm/normal" color="text-muted" style={{ marginTop: "4px" }}>
                            {plugin.description}
                        </Text>
                    )}
                    {plugin.authors && (
                        <Text variant="text-xs/normal" color="text-muted" style={{ marginTop: "2px" }}>
                            by {plugin.authors.map(a => a.name).join(", ")}
                        </Text>
                    )}
                </div>
                <Switch
                    value={isEnabled}
                    onChange={togglePlugin}
                    disabled={disabled}
                />
            </Flex>
        </div>
    );
}

export function PluginListModal({ modalProps }: { modalProps: ModalProps; }) {
    const settings = useSettings();
    const changes = React.useMemo(() => new ChangeList<string>(), []);
    const [searchQuery, setSearchQuery] = React.useState("");

    React.useEffect(() => {
        return () => void (changes.hasChanges && Alerts.show({
            title: "Restart required",
            body: (
                <>
                    <p>The following plugins require a restart:</p>
                    <div>{changes.map((s, i) => (
                        <>
                            {i > 0 && ", "}
                            {Parser.parse("`" + s + "`")}
                        </>
                    ))}</div>
                </>
            ),
            confirmText: "Restart now",
            cancelText: "Later!",
            onConfirm: () => location.reload()
        }));
    }, []);

    const depMap = React.useMemo(() => {
        const o = {} as Record<string, string[]>;
        for (const plugin in Plugins) {
            const deps = Plugins[plugin].dependencies;
            if (deps) {
                for (const dep of deps) {
                    o[dep] ??= [];
                    o[dep].push(plugin);
                }
            }
        }
        return o;
    }, []);

    const sortedPlugins = useMemo(() => {
        return Object.values(Plugins)
            .filter(plugin => plugin?.name?.toLowerCase().includes('atticus') || plugin?.name?.toLowerCase().includes('xaydes'))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, []);

    const filteredPlugins = useMemo(() => {
        if (!searchQuery.trim()) return sortedPlugins;
        
        const query = searchQuery.toLowerCase();
        return sortedPlugins.filter(plugin => 
            plugin.name.toLowerCase().includes(query) || 
            plugin.description?.toLowerCase().includes(query)
        );
    }, [sortedPlugins, searchQuery]);

    const handleSearchChange = (e) => {
        setSearchQuery(e);
    };

    return <ModalRoot {...modalProps} size={ModalSize.MEDIUM} >
        <ModalHeader>
            <Text variant="heading-lg/semibold">Plugin Manager ({filteredPlugins.length})</Text>
        </ModalHeader>
        <ModalContent>
            <div className={cl("search-container")} style={{ marginBottom: "16px" }}>
                <TextInput
                    placeholder="Search plugins..."
                    value={searchQuery}
                    onChange={handleSearchChange}
                    autoFocus={true}
                    type="text"
                />
            </div>
            <div className={cl("grid")} style={{ maxHeight: "400px", overflowY: "auto" }}>
                {filteredPlugins.length > 0 ? (
                    filteredPlugins.map(plugin => {
                        const isRequired = plugin.required || depMap[plugin.name]?.some(d => settings.plugins[d].enabled);
                        
                        if (isRequired) {
                            const tooltipText = plugin.required
                                ? "This plugin is required for equicord to function."
                                : makeDependencyList(depMap[plugin.name]?.filter(d => settings.plugins[d].enabled));

                            return (
                                <Tooltip text={tooltipText} key={plugin.name}>
                                    {({ onMouseLeave, onMouseEnter }) => (
                                        <PluginCard
                                            onMouseLeave={onMouseLeave}
                                            onMouseEnter={onMouseEnter}
                                            onRestartNeeded={name => changes.handleChange(name)}
                                            disabled={true}
                                            plugin={plugin}
                                        />
                                    )}
                                </Tooltip>
                            );
                        } else {
                            return (
                                <PluginCard
                                    key={plugin.name}
                                    onRestartNeeded={name => changes.handleChange(name)}
                                    disabled={false}
                                    plugin={plugin}
                                />
                            );
                        }
                    })
                ) : (
                    <Text style={{ textAlign: "center", padding: "20px" }}>No plugins found matching "{searchQuery}"</Text>
                )}
            </div>
        </ModalContent>
        <ModalFooter>
            <Flex direction={Flex.Direction.HORIZONTAL_REVERSE}>
                <Button color={Button.Colors.RED} onClick={modalProps.onClose}>Close</Button>
            </Flex>
        </ModalFooter>
    </ModalRoot>;
}

function makeDependencyList(deps: string[]) {
    return (
        <React.Fragment>
            <Forms.FormText>This plugin is required by:</Forms.FormText>
            {deps.map((dep: string) => <Forms.FormText key={cl("dep-text")} className={cl("dep-text")}>{dep}</Forms.FormText>)}
        </React.Fragment>
    );
}

export function openPluginList() {
    openModal(modalProps => <PluginListModal modalProps={modalProps} />);
}

function keybind(e: KeyboardEvent) {
    if (e.altKey && e.key.toLowerCase() === 'x') {
        openPluginList();
    }
}

export default {
    name: "pluginManager",
    description: "Manage MeowCord plugins",
    authors: [{ name: "curve", id: 818846027511103508n }, { name: "dot", id: 1400606596521791773n }],
    start() {
        document.addEventListener('keydown', keybind);
    },
    stop() {
        document.removeEventListener('keydown', keybind);
    }
};