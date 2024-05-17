import {bold} from 'chalk';
import GithubSlugger from 'github-slugger';

import {headingInfo} from '../../utils';
import {CUSTOM_ID_EXCEPTION, CUSTOM_ID_REGEXP} from './constants';
import StateCore from 'markdown-it/lib/rules_core/state_core';
import Token from 'markdown-it/lib/token';
import {escapeHtml} from 'markdown-it/lib/common/utils';
import {MarkdownItPluginCb} from '../typings';

const slugify: (str: string, opts: {}) => string = require('slugify');

function createLinkTokens(
    state: StateCore,
    id: string,
    title: string,
    setId = false,
    href: string,
) {
    const open = new state.Token('link_open', 'a', 1);
    const close = new state.Token('link_close', 'a', -1);

    if (setId) {
        open.attrSet('id', id);
    }
    open.attrSet('href', href + '#' + id);
    open.attrSet('class', 'yfm-anchor');
    open.attrSet('aria-hidden', 'true');

    // SEO: render invisible heading title because link must have text content.
    const hiddenDesc = new state.Token('anchor_hidden_desc', '', 0);

    hiddenDesc.content = title;

    return [open, hiddenDesc, close];
}

const getCustomIds = (content: string) => {
    const ids: string[] = [];

    content.replace(CUSTOM_ID_REGEXP, (match, customId) => {
        if (match !== CUSTOM_ID_EXCEPTION) {
            ids.push(customId);
        }

        return '';
    });

    return ids.length ? ids : null;
};

const removeCustomId = (content: string) => {
    if (CUSTOM_ID_REGEXP.test(content)) {
        return content
            .replace(CUSTOM_ID_REGEXP, (match) => {
                if (match === CUSTOM_ID_EXCEPTION) {
                    return match;
                }

                return '';
            })
            .trim();
    }

    return content;
};

const removeCustomIds = (token: Token) => {
    token.content = removeCustomId(token.content);
    token.children?.forEach((child) => {
        child.content = removeCustomId(child.content);
    });
};

interface Options {
    extractTitle?: boolean;
    supportGithubAnchors?: boolean;
    transformLink: (v: string) => string;
    getPublicPath?: (options: Options, v?: string) => string;
}

const index: MarkdownItPluginCb<Options> = (md, options) => {
    const {extractTitle, path, log, supportGithubAnchors, getPublicPath} = options;

    const plugin = (state: StateCore) => {
        /* Do not use the plugin if it is included in the file */
        if (state.env.includes && state.env.includes.length) {
            return;
        }

        const href = getPublicPath ? getPublicPath(options, state.env.path) : '';

        const ids: Record<string, number> = {};
        const tokens = state.tokens;
        let i = 0;
        const slugger = new GithubSlugger();

        while (i < tokens.length) {
            const token = tokens[i];
            const isHeading = token.type === 'heading_open';

            if (isHeading) {
                const {title, level} = headingInfo(tokens, i);

                const inlineToken = tokens[i + 1];
                let id = token.attrGet('id');
                let ghId: string;

                if (!title) {
                    log.warn(`Header without title${path ? ` in ${bold(path)}` : ''}`);
                }

                if (level < 2 && extractTitle) {
                    // if there are any custom ids in the level 1 heading we should clear them
                    removeCustomIds(tokens[i + 1]);
                    i += 3;
                    continue;
                }

                const customIds = getCustomIds(inlineToken.content);
                if (customIds) {
                    id = customIds[0];
                    removeCustomIds(tokens[i + 1]);
                } else {
                    id = slugify(title, {
                        lower: true,
                        remove: /[*+~.()'"!:@`ь]/g,
                    });
                    ghId = slugger.slug(title);
                }

                token.attrSet('id', id);

                if (ids[id]) {
                    id = id + ids[id]++;
                    token.attrSet('id', id);
                } else {
                    ids[id] = 1;
                }

                const allAnchorIds = customIds ? customIds : [id];
                const anchorTitle = removeCustomId(title).replace(/`/g, '');
                allAnchorIds.forEach((customId) => {
                    const setId = id !== customId;
                    const linkTokens = createLinkTokens(state, customId, anchorTitle, setId, href);

                    inlineToken.children?.unshift(...linkTokens);

                    if (supportGithubAnchors) {
                        const ghLinkTokens = createLinkTokens(state, ghId, anchorTitle, true, href);
                        inlineToken.children?.unshift(...ghLinkTokens);
                    }
                });

                i += 3;
                continue;
            }

            i++;
        }
    };

    try {
        md.core.ruler.after('includes', 'anchors', plugin);
    } catch {
        try {
            md.core.ruler.after('curly_attributes', 'anchors', plugin);
        } catch {
            md.core.ruler.push('anchors', plugin);
        }
    }

    md.renderer.rules.anchor_hidden_desc = function (tokens, index) {
        return '<span class="visually-hidden">' + escapeHtml(tokens[index].content) + '</span>';
    };
};

export = index;
