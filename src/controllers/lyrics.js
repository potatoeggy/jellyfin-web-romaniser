import escapeHtml from 'escape-html';
import pinyin from 'pinyin';
// import * as wanakana from 'wanakana';
import * as cantonese from 'cantonese-romanisation';
import * as TradOrSimp from 'traditional-or-simplified-modified';
import { romanize } from 'koroman';
import kuroshiro from 'kuroshiro';
// Initialize kuroshiro with an instance of analyzer (You could check the [apidoc](#initanalyzer) for more information):
// For this example, you should npm install and import the kuromoji analyzer first

import autoFocuser from 'components/autoFocuser';
import { appRouter } from '../components/router/appRouter';
import layoutManager from 'components/layoutManager';
import { playbackManager } from '../components/playback/playbackmanager';
import ServerConnections from '../components/ServerConnections';
import scrollManager from 'components/scrollManager';
import focusManager from 'components/focusManager';

import keyboardNavigation from 'scripts/keyboardNavigation';
import globalize from 'lib/globalize';
import LibraryMenu from 'scripts/libraryMenu';
import Events from 'utils/events';

import '../styles/lyrics.scss';
import { AutoScroll } from './lyrics.types';

let currentPlayer;
let currentItem;

let savedLyrics;
let isDynamicLyric = false;
let autoScroll = AutoScroll.Instant;

const chineseRegex = /\p{Script=Han}/u;
const nonChineseRegex = /^[^\p{Script=Han}]*$/u;

kuroshiro.init(() => {
    console.log('Kuroshiro initialized');
});

function isStringChinese(text) {
    return chineseRegex.test(text);
}

function isStringJapanese(text) {
    // if there is at least one -gana character (kanji can be canto or mando)
    try {
        return kuroshiro.hasHiragana(text) || kuroshiro.hasKatakana(text);
    } catch (e) {
        console.error('Error in isStringJapanese:', e);
        return false;
    }
}

/***
 * @param {string} text
 * @returns {boolean}
 */
function isStringKorean(text) {
    const match = text.match(/[\u3131-\uD79D]/g);
    return match?.length > 0;
}

function getContentType(line) {
    // if ([...line].some(s => isStringJapanese(s) && !isStringChinese(s))) {
    //     return 'japanese';
    // }

    if (isStringJapanese(line)) {
        return 'japanese';
    }

    if ([...line].some(isStringChinese)) {
        return 'chinese';
    }

    if ([...line].some(isStringKorean)) {
        return 'korean';
    }

    return 'english';
}

function getLyricHtml(content) {
    const contentType = getContentType(content);
    console.log('content type:', contentType);

    const newContent = [];

    if (contentType === 'chinese') {
        const isTraditional = TradOrSimp.isTraditional(content.replace(nonChineseRegex, ''));

        const cleaned = isTraditional ?
            cantonese.getYale(content) : pinyin(content, {
                style: 'tone',
                heteronym: true,
                segment: true
            });

        let originalIndex = 0;
        for (let [cleanedItem] of cleaned) {
            cleanedItem ??= ' ';
            const cleanedCleaned = isTraditional ? cleanedItem.substring(0, cleanedItem.length - 1) : cleanedItem;
            const originalItem = content[originalIndex];

            if (isStringChinese(originalItem) || isTraditional) { // traditional creates one array per char
                newContent.push(`${originalItem} <rt>${cleanedCleaned}</rt>`);
                originalIndex++;
            } else {
                const original = content.substring(originalIndex, originalIndex + cleanedItem.length);
                newContent.push(`${original.trim() || '&nbsp;'} <rt></rt>`);
                originalIndex += cleanedCleaned.length;
            }
        }
    } else if (contentType === 'japanese') {
        //const cleaned = wanakana.tokenize(content).map(token => wanakana.toRomaji(token));
        try {
            const cleaned = kuroshiro.convert(content, { to: 'romaji', mode: 'spaced' }).split();
            console.log('converted:', cleaned);
            const contentArray = content.split();

            let originalIndex = 0;
            for (const cleanedItem of cleaned) {
                const originalItem = contentArray[originalIndex];

                if (isStringJapanese(originalItem)) {
                    newContent.push(`${originalItem} <rt>${cleanedItem}</rt>`);
                    originalIndex++;
                } else {
                    newContent.push(`${originalItem.trim() || '&nbsp;'} <rt></rt>`);
                    originalIndex++;
                }
            }
        } catch (e) {
            // console.error('Error in Japanese conversion:', e);
            return content;
        }
    } else if (contentType === 'korean') {
        const romanised = romanize(content);

        const contentArray = content.split();
        let originalIndex = 0;
        for (const cleanedItem of romanised.split()) {
            const originalItem = contentArray[originalIndex];

            if (isStringKorean(originalItem)) {
                newContent.push(`${originalItem} <rt>${cleanedItem}</rt>`);
                originalIndex++;
            } else {
                newContent.push(`${originalItem.trim() || '&nbsp;'} <rt></rt>`);
                originalIndex++;
            }
        }
    }

    console.log(newContent);

    return newContent.length ? `<ruby>${newContent.join('\n')}</ruby>` : content;
}

function dynamicLyricHtmlReducer(htmlAccumulator, lyric, index) {
    const content = escapeHtml(lyric.Text);

    if (layoutManager.tv) {
        htmlAccumulator += `
        <button class="lyricsLine dynamicLyric listItem show-focus" id="lyricPosition${index}" data-lyrictime="${lyric.Start}">
            ${getLyricHtml(content)}
        </button>`;
    } else {
        htmlAccumulator += `
        <div class="lyricsLine dynamicLyric" id="lyricPosition${index}" data-lyrictime="${lyric.Start}">
            ${getLyricHtml(content)}
        </div>`;
    }
    return htmlAccumulator;
}

function staticLyricHtmlReducer(htmlAccumulator, lyric, index) {
    if (layoutManager.tv) {
        htmlAccumulator += `
        <button class="lyricsLine listItem show-focus" id="lyricPosition${index}">
            ${getLyricHtml(escapeHtml(lyric.Text))}
        </button>`;
    } else {
        htmlAccumulator += `
        <div class="lyricsLine" id="lyricPosition${index}">
            ${getLyricHtml(escapeHtml(lyric.Text))}
        </div>`;
    }
    return htmlAccumulator;
}

function getLyricIndex(time, lyrics) {
    return lyrics.findLastIndex(lyric => lyric.Start <= time);
}

function getCurrentPlayTime() {
    let currentTime = playbackManager.currentTime();
    if (currentTime === undefined) currentTime = 0;
    //convert to ticks
    return currentTime * 10000;
}

export default function (view) {
    function setPastLyricClassOnLine(line) {
        const lyric = view.querySelector(`#lyricPosition${line}`);
        if (lyric) {
            lyric.classList.remove('futureLyric');
            lyric.classList.add('pastLyric');
        }
    }

    function setFutureLyricClassOnLine(line) {
        const lyric = view.querySelector(`#lyricPosition${line}`);
        if (lyric) {
            lyric.classList.remove('pastLyric');
            lyric.classList.add('futureLyric');
        }
    }

    function setCurrentLyricClassOnLine(line) {
        const lyric = view.querySelector(`#lyricPosition${line}`);
        if (lyric) {
            lyric.classList.remove('pastLyric');
            lyric.classList.remove('futureLyric');
            if (autoScroll !== AutoScroll.NoScroll) {
                // instant scroll is used when the view is first loaded
                scrollManager.scrollToElement(lyric, autoScroll === AutoScroll.Smooth);
                focusManager.focus(lyric);
                autoScroll = AutoScroll.Smooth;
            }
        }
    }

    function updateAllLyricLines(currentLine, lyrics) {
        for (let lyricIndex = 0; lyricIndex <= lyrics.length; lyricIndex++) {
            if (lyricIndex < currentLine) {
                setPastLyricClassOnLine(lyricIndex);
            } else if (lyricIndex === currentLine) {
                setCurrentLyricClassOnLine(lyricIndex);
            } else if (lyricIndex > currentLine) {
                setFutureLyricClassOnLine(lyricIndex);
            }
        }
    }

    function renderNoLyricMessage() {
        const itemsContainer = view.querySelector('.dynamicLyricsContainer');
        if (itemsContainer) {
            const html = `<h1> ${globalize.translate('HeaderNoLyrics')} </h1>`;
            itemsContainer.innerHTML = html;
        }
        autoFocuser.autoFocus();
    }

    function renderDynamicLyrics(lyrics) {
        const itemsContainer = view.querySelector('.dynamicLyricsContainer');
        if (itemsContainer) {
            const html = lyrics.reduce(dynamicLyricHtmlReducer, '');
            itemsContainer.innerHTML = html;
        }

        const lyricLineArray = itemsContainer.querySelectorAll('.lyricsLine');

        // attaches click event listener to change playtime to lyric start
        lyricLineArray.forEach(element => {
            element.addEventListener('click', () => onLyricClick(element.getAttribute('data-lyrictime')));
        });

        const currentIndex = getLyricIndex(getCurrentPlayTime(), lyrics);
        updateAllLyricLines(currentIndex, savedLyrics);
    }

    function renderStaticLyrics(lyrics) {
        const itemsContainer = view.querySelector('.dynamicLyricsContainer');
        if (itemsContainer) {
            const html = lyrics.reduce(staticLyricHtmlReducer, '');
            itemsContainer.innerHTML = html;
        }
    }

    function updateLyrics(lyrics) {
        savedLyrics = lyrics;

        isDynamicLyric = Object.prototype.hasOwnProperty.call(lyrics[0], 'Start');

        if (isDynamicLyric) {
            renderDynamicLyrics(savedLyrics);
        } else {
            renderStaticLyrics(savedLyrics);
        }

        autoFocuser.autoFocus(view);
    }

    function getLyrics(serverId, itemId) {
        const apiClient = ServerConnections.getApiClient(serverId);

        return apiClient.ajax({
            url: apiClient.getUrl('Audio/' + itemId + '/Lyrics'),
            type: 'GET',
            dataType: 'json'
        }).then((response) => {
            if (!response.Lyrics) {
                throw new Error();
            }
            return response.Lyrics;
        });
    }

    function bindToPlayer(player) {
        if (player === currentPlayer) {
            return;
        }

        releaseCurrentPlayer();

        currentPlayer = player;

        if (!player) {
            return;
        }

        Events.on(player, 'timeupdate', onTimeUpdate);
        Events.on(player, 'playbackstart', onPlaybackStart);
        Events.on(player, 'playbackstop', onPlaybackStop);
    }

    function releaseCurrentPlayer() {
        const player = currentPlayer;

        if (player) {
            Events.off(player, 'timeupdate', onTimeUpdate);
            Events.off(player, 'playbackstart', onPlaybackStart);
            Events.off(player, 'playbackstop', onPlaybackStop);
            currentPlayer = null;
        }
    }

    function onLyricClick(lyricTime) {
        autoScroll = AutoScroll.Smooth;
        playbackManager.seek(lyricTime);
        if (playbackManager.paused()) {
            playbackManager.playPause(currentPlayer);
        }
    }

    function onTimeUpdate() {
        if (isDynamicLyric) {
            const currentIndex = getLyricIndex(getCurrentPlayTime(), savedLyrics);
            updateAllLyricLines(currentIndex, savedLyrics);
        }
    }

    function onPlaybackStart(event, state) {
        if (currentItem.Id !== state.NowPlayingItem.Id) {
            onLoad();
        }
    }

    function onPlaybackStop(_, state) {
        // TODO: switch to appRouter.back(), with fix to navigation to /#/queue. Which is broken when it has nothing playing
        if (!state.NextMediaType) {
            appRouter.goHome();
        }
    }

    function onPlayerChange() {
        const player = playbackManager.getCurrentPlayer();
        bindToPlayer(player);
    }

    function onLoad() {
        savedLyrics = null;
        currentItem = null;
        isDynamicLyric = false;

        LibraryMenu.setTitle(globalize.translate('Lyrics'));

        const player = playbackManager.getCurrentPlayer();

        if (player) {
            bindToPlayer(player);

            const state = playbackManager.getPlayerState(player);
            currentItem = state.NowPlayingItem;

            const serverId = state.NowPlayingItem.ServerId;
            const itemId = state.NowPlayingItem.Id;

            getLyrics(serverId, itemId).then(updateLyrics).catch(renderNoLyricMessage);
        } else {
            // if nothing is currently playing, no lyrics to display redirect to home
            appRouter.goHome();
        }
    }

    function onWheelOrTouchMove() {
        autoScroll = AutoScroll.NoScroll;
    }

    function onKeyDown(e) {
        const key = keyboardNavigation.getKeyName(e);
        if (key === 'ArrowUp' || key === 'ArrowDown') {
            autoScroll = AutoScroll.NoScroll;
        }
    }

    view.addEventListener('viewshow', function () {
        Events.on(playbackManager, 'playerchange', onPlayerChange);
        autoScroll = AutoScroll.Instant;
        document.addEventListener('wheel', onWheelOrTouchMove);
        document.addEventListener('touchmove', onWheelOrTouchMove);
        document.addEventListener('keydown', onKeyDown);
        try {
            onLoad();
        } catch (e) {
            appRouter.goHome();
        }
    });

    view.addEventListener('viewbeforehide', function () {
        Events.off(playbackManager, 'playerchange', onPlayerChange);
        document.removeEventListener('wheel', onWheelOrTouchMove);
        document.removeEventListener('touchmove', onWheelOrTouchMove);
        document.removeEventListener('keydown', onKeyDown);
        releaseCurrentPlayer();
    });
}
