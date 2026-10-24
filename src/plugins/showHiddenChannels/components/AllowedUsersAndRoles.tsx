/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { openUserProfile } from "@utils/discord";
import type { Channel, Role, User } from "@vencord/discord-types";
import { PermissionOverwriteType } from "@vencord/discord-types/enums";
import { findByCodeLazy, findByPropsLazy, findComponentByCodeLazy } from "@webpack";
import { ContextMenuApi, GuildMemberStore, GuildRoleStore, GuildStore, IconUtils, PermissionsBits, PermissionStore, Popout, RoleMemberPopout, useEffect, useRef, UserStore, UserUtils, useState, useStateFromStores } from "@webpack/common";

import { cl } from "..";

// Reuse profile role pills so role-enhancement plugins can handle these too.
const ProfileRolePill = findComponentByCodeLazy("enableTooltip:!1", ".colorString");
const UserContextMenu = findComponentByCodeLazy('navId:"user-context"');
const GuildActions = findByPropsLazy("requestMembersById", "banUser");
const loadRoleMembers = findByCodeLazy(".GUILD_ROLE_MEMBER_IDS(", "requestMembersById");

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

function ClickableUser({ userId, channel }: { userId: string; channel: Channel; }) {
    const [user, setUser] = useState<User | undefined>(() => UserStore.getUser(userId));

    useEffect(() => {
        if (user) return;

        let cancelled = false;
        UserUtils.getUser(userId)
            .then(resolvedUser => {
                if (!cancelled) setUser(resolvedUser);
            })
            .catch(() => { });

        return () => { cancelled = true; };
    }, [userId]);

    if (!user) {
        return (
            <button className={cl("access-user")} onClick={() => openUserProfile(userId)}>
                Loading user...
            </button>
        );
    }

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

function ClickableRole({ role, channel }: { role: Role; channel: Channel; }) {
    const targetRef = useRef<HTMLButtonElement>(null);

    return (
        <Popout
            position="bottom"
            align="center"
            targetElementRef={targetRef}
            preload={() => loadRoleMembers(channel.guild_id, role.id)}
            renderPopout={popoutProps => (
                <RoleMemberPopout
                    popoutProps={popoutProps}
                    guildId={channel.guild_id}
                    channelId={channel.id}
                    roleId={role.id}
                />
            )}
        >
            {popoutProps => (
                <button
                    {...popoutProps}
                    ref={targetRef}
                    className={cl("access-role")}
                    aria-label={`View members of ${role.name}`}
                >
                    <ProfileRolePill role={role} guildId={channel.guild_id} />
                </button>
            )}
        </Popout>
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

    const uniqueUserIds = Array.from(new Set(userIds));

    useEffect(() => {
        if (uniqueUserIds.length) GuildActions.requestMembersById(guildId, uniqueUserIds, false);
    }, [channel.id, uniqueUserIds.join(",")]);

    const allowedUserIds = useStateFromStores(
        [GuildMemberStore],
        () => uniqueUserIds.filter(userId => {
            if (userId === guild?.ownerId || !GuildMemberStore.getMember(guildId, userId)) return true;

            return (
                PermissionStore.computePermissions(channel, guildId, channel.permissionOverwrites, userId) & permission
            ) === permission;
        }),
        [channel.id, uniqueUserIds.join(",")]
    );

    return (
        <div className={cl("access-list")}>
            {roles.map(role => (
                <ClickableRole key={role.id} role={role} channel={channel} />
            ))}
            {allowedUserIds.map(userId => <ClickableUser key={userId} userId={userId} channel={channel} />)}
            {roles.length === 0 && allowedUserIds.length === 0 && (
                <div className={cl("access-empty")}>No allowed users or roles found.</div>
            )}
        </div>
    );
}

export default ErrorBoundary.wrap(AllowedUsersAndRoles);
