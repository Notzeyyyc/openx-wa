import fs from 'fs';
import path from 'path';
import { loadJsonConfig, writeJsonConfig } from '../config.js';

const GROUPS_DB_PATH = './package/groups-db.json';

/**
 * Load all groups data
 */
function loadGroupsDb() {
    return loadJsonConfig(GROUPS_DB_PATH, {});
}

/**
 * Save groups data
 */
function saveGroupsDb(data) {
    writeJsonConfig(GROUPS_DB_PATH, data);
}

/**
 * Get group training data
 */
export function getGroupTraining(jid) {
    const db = loadGroupsDb();
    return db[jid] || null;
}

/**
 * Save group training data
 */
export function saveGroupTraining(jid, data) {
    const db = loadGroupsDb();
    db[jid] = {
        ...db[jid],
        ...data,
        lastUpdated: Date.now()
    };
    saveGroupsDb(db);
}

/**
 * Train group - fetch info and save
 */
export async function trainGroup(waSock, jid) {
    try {
        // Get group metadata
        const metadata = await waSock.groupMetadata(jid);
        
        // Get member list
        const members = metadata.participants || [];
        const memberList = members.map(m => ({
            id: m.id,
            name: m.id.split('@')[0],
            isAdmin: m.admin === 'admin' || m.admin === 'superadmin'
        }));

        // Build training data
        const trainingData = {
            name: metadata.subject || 'Unknown Group',
            description: metadata.desc || '',
            owner: metadata.owner || '',
            memberCount: members.length,
            members: memberList,
            rules: [], // User can add rules later
            topics: [], // User can add topics later
            createdAt: Date.now()
        };

        saveGroupTraining(jid, trainingData);
        return { ok: true, data: trainingData };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

/**
 * Add member to group (when someone joins)
 */
export function addGroupMember(jid, memberJid, memberName) {
    const db = loadGroupsDb();
    if (!db[jid]) {
        db[jid] = { members: [], name: 'Unknown Group', memberCount: 0, createdAt: Date.now() };
    }
    
    const exists = db[jid].members.some(m => m.id === memberJid);
    if (!exists) {
        db[jid].members.push({
            id: memberJid,
            name: memberName || memberJid.split('@')[0],
            isAdmin: false,
            joinedAt: Date.now()
        });
        db[jid].memberCount = db[jid].members.length;
        saveGroupsDb(db);
    }
}

/**
 * Remove member from group (when someone leaves)
 */
export function removeGroupMember(jid, memberJid) {
    const db = loadGroupsDb();
    if (!db[jid]?.members) return;
    
    db[jid].members = db[jid].members.filter(m => m.id !== memberJid);
    db[jid].memberCount = db[jid].members.length;
    saveGroupsDb(db);
}

/**
 * Add rule to group
 */
export function addGroupRule(jid, rule) {
    const db = loadGroupsDb();
    if (!db[jid]) {
        db[jid] = { members: [], rules: [], topics: [], name: 'Unknown Group', createdAt: Date.now() };
    }
    if (!db[jid].rules) db[jid].rules = [];
    db[jid].rules.push({
        id: Date.now().toString().slice(-6),
        text: rule,
        addedAt: Date.now()
    });
    saveGroupsDb(db);
}

/**
 * Remove rule from group
 */
export function removeGroupRule(jid, ruleId) {
    const db = loadGroupsDb();
    if (!db[jid]?.rules) return false;
    
    const idx = db[jid].rules.findIndex(r => r.id === ruleId);
    if (idx === -1) return false;
    db[jid].rules.splice(idx, 1);
    saveGroupsDb(db);
    return true;
}

/**
 * Add topic to group
 */
export function addGroupTopic(jid, topic) {
    const db = loadGroupsDb();
    if (!db[jid]) {
        db[jid] = { members: [], rules: [], topics: [], name: 'Unknown Group', createdAt: Date.now() };
    }
    if (!db[jid].topics) db[jid].topics = [];
    if (!db[jid].topics.includes(topic)) {
        db[jid].topics.push(topic);
        saveGroupsDb(db);
    }
}

/**
 * Get group context for AI
 */
export function getGroupContext(jid) {
    const data = getGroupTraining(jid);
    if (!data) return '';

    const lines = [];
    lines.push(`Group: ${data.name}`);
    if (data.description) lines.push(`Description: ${data.description}`);
    lines.push(`Members: ${data.memberCount}`);
    
    if (data.members?.length > 0) {
        const admins = data.members.filter(m => m.isAdmin).map(m => m.name);
        const regular = data.members.filter(m => !m.isAdmin).map(m => m.name);
        if (admins.length > 0) lines.push(`Admins: ${admins.join(', ')}`);
        if (regular.length > 0) lines.push(`Members: ${regular.slice(0, 10).join(', ')}${regular.length > 10 ? ` +${regular.length - 10} more` : ''}`);
    }
    
    if (data.rules?.length > 0) {
        lines.push(`Rules: ${data.rules.map(r => r.text).join('; ')}`);
    }
    
    if (data.topics?.length > 0) {
        lines.push(`Topics: ${data.topics.join(', ')}`);
    }

    return lines.join('\n');
}

/**
 * List all groups
 */
export function listGroups() {
    const db = loadGroupsDb();
    return Object.entries(db).map(([jid, data]) => ({
        jid,
        name: data.name || 'Unknown',
        members: data.memberCount || 0,
        lastUpdated: data.lastUpdated
    }));
}
