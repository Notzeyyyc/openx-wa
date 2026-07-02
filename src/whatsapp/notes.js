import fs from 'fs';
import { loadJsonConfig, writeJsonConfig } from '../config.js';

const NOTES_PATH = './package/notes.json';

function loadNotes(chatId) {
    const all = loadJsonConfig(NOTES_PATH, {});
    return all[chatId] || [];
}

function saveNotes(chatId, notes) {
    const all = loadJsonConfig(NOTES_PATH, {});
    all[chatId] = notes;
    writeJsonConfig(NOTES_PATH, all);
}

export function addNote(chatId, text) {
    const notes = loadNotes(chatId);
    const note = {
        id: Date.now().toString().slice(-6),
        text,
        created: new Date().toISOString()
    };
    notes.push(note);
    saveNotes(chatId, notes);
    return note;
}

export function listNotes(chatId) {
    return loadNotes(chatId);
}

export function deleteNote(chatId, noteId) {
    const notes = loadNotes(chatId);
    const idx = notes.findIndex(n => n.id === noteId);
    if (idx === -1) return false;
    notes.splice(idx, 1);
    saveNotes(chatId, notes);
    return true;
}

export function searchNotes(chatId, query) {
    const notes = loadNotes(chatId);
    const lower = query.toLowerCase();
    return notes.filter(n => n.text.toLowerCase().includes(lower));
}
