/** The segments in the order they appear in the video (the title and end cards frame them). */
import live from './live.mjs';
import canvas from './canvas.mjs';
import paper from './paper.mjs';
import chatbot from './chatbot.mjs';
import gym from './gym.mjs';
import lookup from './lookup.mjs';
import panes from './panes.mjs';
import phone from './phone.mjs';
import setup from './setup.mjs';

export const SEGMENTS = [live, canvas, paper, chatbot, gym, lookup, panes, phone, setup];
