import definePlugin, { OptionType } from "@utils/types";
import { RestAPI, UserStore } from "@webpack/common";
import { ApplicationCommandInputType, ApplicationCommandOptionType, sendBotMessage } from "@api/Commands";

export default definePlugin({
    name: "fakeDms",
    description: "Create live fake dms",
    authors: [{ name: "curve", id: 818846027511103508n }, { name: "dot", id: 1400606596521791773n }],
    commands: [
        {
            name: "Fake Message",
            description: "Creates a fake message",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "Message",
                    description: "Enter fake message",
                    type: ApplicationCommandOptionType.STRING,
                    required: false
                },
                {
                    name: "User",
                    description: "Select a User",
                    required: false,
                    type: ApplicationCommandOptionType.USER,
                },
                {
                    name: "custom-user",
                    description: "Enter user Id",
                    required: false,
                    type: ApplicationCommandOptionType.STRING,
                },
                {
                    name: "messageLink",
                    description: "Enter a message Id",
                    required: false,
                    type: ApplicationCommandOptionType.STRING,

                },
            ],
            execute: async (opts, ctx) => {
                const User = opts.find(opt => opt.name === "User" || opt.name === "custom-user")?.value;
                const messageLink = opts.find(opt => opt.name === "messageLink")?.value;
                const message = opts.find(opt => opt.name === "Message")?.value;
                const self = UserStore.getCurrentUser().id === User;

                let embeds = [], attachments = [];
                if (messageLink) {
                    const [channelId, messageId] = messageLink.split("/").slice(-2);
                    const message = await searchAPI(channelId, messageId);
                    embeds = message[0].embeds;
                    attachments = message[0].attachments;
                }
                fakeMessage(ctx.channel.id, message, self, User, attachments, embeds);
            }
        },
    ],
});

const fakeMessage = (channelId, content, self, id, attachments: any[] = [], embeds: any[] = []) => {
    sendBotMessage(channelId, {
        author: {
            avatar: self ? UserStore.getCurrentUser().avatar : UserStore.getUser(id).avatar,
            username: self ? UserStore.getCurrentUser().username : UserStore.getUser(id).username,
            bot: false,
            id: id,
        },
        content: content,
        attachments: attachments,
        embeds: embeds,
        flags: 0,
    });
};

const searchAPI = async (channelID, messageID) => {
    const { body } = await RestAPI.get({
        url: `/channels/${channelID}/messages`,
        query: {
            limit: 1,
            around: messageID
        },
    }).catch(async (e) => null);
    return body;
};



