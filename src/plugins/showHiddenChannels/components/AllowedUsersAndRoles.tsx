/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { openUserProfile } from "@utils/discord";
import { isTruthy } from "@utils/guards";
import type { Channel, Role, User } from "@vencord/discord-types";
import { PermissionOverwriteType } from "@vencord/discord-types/enums";
import { findComponentByCodeLazy } from "@webpack";
import { ContextMenuApi, GuildRoleStore, GuildStore, IconUtils, PermissionsBits, PermissionStore, UserStore, useStateFromStores } from "@webpack/common";

import { cl } from "..";

// Reuse profile role pills so role-enhancement plugins can handle these too.
const ProfileRolePill = findComponentByCodeLazy("enableTooltip:!1", ".colorString");
const UserContextMenu = findComponentByCodeLazy('navId:"user-context"');

function roleCanAccess(role: Role, channel: Channel, permission: bigint) {
    const { guild_id: guildId, permissionOverwrites } = channel;
    const everyoneRole = GuildRoleStore.getRole(guildId, guildId);
    let permissions = (everyoneRole?.permissions ?? 0n) | role.permissions;

    if ((permissions & PermissionsBits.ADMINISTRATOR) === PermissionsBits.ADMINISTRATOR) return true;

    const everyoneOverwrite = permissionOverwrites[guildId];
    if (everyoneOverwrite) {
        permissions &= ~everyoneOverwrite.deny;
        permissions |= everyoneOverwrite.allow;
    }

    if (role.id !== guildId) {
        const roleOverwrite = permissionOverwrites[role.id];
        if (roleOverwrite) {
            permissions &= ~roleOverwrite.deny;
            permissions |= roleOverwrite.allow;
        }
    }

    return (permissions & permission) === permission;
}

function ClickableUser({ user, channel }: { user: User; channel: Channel; }) {
    return (
        <button
            className={cl("access-user")}
            onClick={() => openUserProfile(user.id)}
            onContextMenu={event => ContextMenuApi.openContextMenu(event, () => (
                <UserContextMenu user={user} guildId={channel.guild_id} channel={channel} />
            ))}
        >
            <img src={IconUtils.getUserAvatarURL(user)} alt="" className={cl("access-avatar")} />
            {user.globalName ?? user.username}
        </button>
    );
}

function AllowedUsersAndRoles({ channel }: { channel: Channel; }) {
    const guildId = channel.guild_id;
    const guild = GuildStore.getGuild(guildId);
    const permission = PermissionStore.can(PermissionsBits.VIEW_CHANNEL, channel)
        ? PermissionsBits.CONNECT
        : PermissionsBits.VIEW_CHANNEL;

    let roles = GuildRoleStore.getSortedRoles(guildId)
        .filter(role => roleCanAccess(role, channel, permission));
    const everyoneRole = roles.find(role => role.id === guildId);
    if (everyoneRole) roles = [everyoneRole];

    const userIds = Object.values(channel.permissionOverwrites)
        .filter(overwrite => overwrite.type === PermissionOverwriteType.MEMBER)
        .map(overwrite => overwrite.id);
    if (guild?.ownerId) userIds.unshift(guild.ownerId);

    const uniqueUserIds = Array.from(new Set(userIds)).filter(userId => (
        PermissionStore.computePermissions(channel, guildId, channel.permissionOverwrites, userId) & permission
    ) === permission);

    const users = useStateFromStores(
        [UserStore],
        () => uniqueUserIds.map(userId => UserStore.getUser(userId)).filter(isTruthy),
        [channel.id, uniqueUserIds.join(",")]
    );

    return (
        <div className={cl("access-list")}>
            {roles.map(role => (
                <ProfileRolePill key={role.id} role={role} guildId={guildId} />
            ))}
            {users.map(user => <ClickableUser key={user.id} user={user} channel={channel} />)}
            {roles.length === 0 && users.length === 0 && (
                <div className={cl("access-empty")}>No allowed users or roles found.</div>
            )}
        </div>
    );
}

export default ErrorBoundary.wrap(AllowedUsersAndRoles);
