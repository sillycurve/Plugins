import definePlugin, { OptionType } from "@utils/types";
import { ApplicationCommandInputType, ApplicationCommandOptionType } from "@api/Commands";
import { Util } from "Vencord";

export default definePlugin({
    name: "profileViewer",
    description: "allows you to view a profile and it's id using commands",
    authors: [{ name: "curve", id: 818846027511103508n }, { name: "dot", id: 1400606596521791773n }],
    dependencies: ["CommandsAPI", "MessageEventsAPI", "ValidUser"],
    commands: [
        {
            name: "profile",
            description: "shows you the profile of the person",
            inputType: ApplicationCommandInputType.BUILT_IN,
            options: [
                {
                    name: "User",
                    description: "Select a User",
                    required: false,
                    type: ApplicationCommandOptionType.USER,
                }
            ],
            execute: async (opts, ctx) => {
                const user = opts.find(opt => opt.name === "User")?.value;
                Util.openUserProfile(user);

            }
        }
    ]
});
