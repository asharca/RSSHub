import { load } from 'cheerio';

import { config } from '@/config';
import ConfigNotFoundError from '@/errors/types/config-not-found';
import InvalidParameterError from '@/errors/types/invalid-parameter';
import type { Route } from '@/types';
import { ViewType } from '@/types';
import got from '@/utils/got';

// Subset of https://github.com/ozh/github-colors
const LANG_COLORS: Record<string, string> = {
    JavaScript: '#f1e05a',
    TypeScript: '#2b7489',
    Python: '#3572A5',
    Go: '#00ADD8',
    Rust: '#dea584',
    Java: '#b07219',
    'C++': '#f34b7d',
    C: '#555555',
    Ruby: '#701516',
    PHP: '#4F5D95',
    Shell: '#89e051',
    Swift: '#F05138',
    Kotlin: '#A97BFF',
    Dart: '#00B4AB',
    Scala: '#c22d40',
    HTML: '#e34c26',
    CSS: '#563d7c',
    Vue: '#41b883',
    Nix: '#7e7eff',
};

const FALLBACK_COLOR = '#8b949e';

function formatCount(n: number): string {
    if (n >= 1000) {
        return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    }
    return String(n);
}

function buildSvg(repos: Repo[], since: string, language: string): string {
    const W = 800;
    const ROW_H = 36;
    const HEADER_H = 48;
    const TITLE_H = 52;
    const PAD = 16;

    // columns: rank | repo | lang | stars | forks | period gain
    // total content width = W - 2*PAD = 768, distributed below
    const C = {
        rank: { x: PAD, w: 36 }, // right-aligned
        repo: { x: 52, w: 260 }, // left-aligned
        lang: { x: 312, w: 150 }, // dot+text left-aligned
        stars: { x: 462, w: 92 }, // right-aligned
        forks: { x: 554, w: 84 }, // right-aligned
        gain: { x: 638, w: 146 }, // right-aligned, ends at W-PAD=784
    };

    const totalH = TITLE_H + HEADER_H + repos.length * ROW_H + 1;

    const rows = repos
        .map((repo, i) => {
            const y = TITLE_H + HEADER_H + i * ROW_H;
            const bg = i % 2 === 0 ? '#ffffff' : '#f6f8fa';
            const dotColor = LANG_COLORS[repo.lang ?? ''] ?? FALLBACK_COLOR;
            const langLabel = repo.lang ?? '';
            const gainText = repo.periodStars > 0 ? `↑ ${formatCount(repo.periodStars)}` : '—';

            return `
<rect x="0" y="${y}" width="${W}" height="${ROW_H}" fill="${bg}"/>
<text x="${C.rank.x + C.rank.w}" y="${y + 23}" text-anchor="end" fill="#57606a" font-size="13">${i + 1}</text>
<text x="${C.repo.x}" y="${y + 23}" fill="#0969da" font-size="13" font-weight="500">${escSvg(repo.nameWithOwner)}</text>
<circle cx="${C.lang.x + 7}" cy="${y + 18}" r="5" fill="${dotColor}"/>
<text x="${C.lang.x + 18}" y="${y + 23}" fill="#24292f" font-size="13">${escSvg(langLabel)}</text>
<text x="${C.stars.x + C.stars.w}" y="${y + 23}" text-anchor="end" fill="#24292f" font-size="13">★ ${formatCount(repo.stars)}</text>
<text x="${C.forks.x + C.forks.w}" y="${y + 23}" text-anchor="end" fill="#57606a" font-size="13">⑂ ${formatCount(repo.forks)}</text>
<text x="${C.gain.x + C.gain.w}" y="${y + 23}" text-anchor="end" fill="${repo.periodStars > 0 ? '#1a7f37' : '#57606a'}" font-size="13" font-weight="${repo.periodStars > 0 ? '600' : '400'}">${gainText}</text>`;
        })
        .join('');

    const label = language === 'any' || !language ? 'All Languages' : language;
    const gainHeader = since === 'daily' ? 'Today' : since === 'weekly' ? 'This week' : 'This month';

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${totalH}" font-family="system-ui,-apple-system,sans-serif">
<rect width="${W}" height="${totalH}" fill="#ffffff" rx="6"/>
<rect width="${W}" height="${totalH}" fill="none" stroke="#d0d7de" rx="6"/>

<!-- title -->
<text x="${PAD}" y="34" font-size="16" font-weight="600" fill="#24292f">GitHub Trending · ${escSvg(since)} · ${escSvg(label)}</text>

<!-- header -->
<rect x="0" y="${TITLE_H}" width="${W}" height="${HEADER_H}" fill="#f6f8fa"/>
<line x1="0" y1="${TITLE_H}" x2="${W}" y2="${TITLE_H}" stroke="#d0d7de"/>
<text x="${C.rank.x + C.rank.w}" y="${TITLE_H + 30}" text-anchor="end" fill="#57606a" font-size="12" font-weight="600">#</text>
<text x="${C.repo.x}" y="${TITLE_H + 30}" fill="#57606a" font-size="12" font-weight="600">Repository</text>
<text x="${C.lang.x + 18}" y="${TITLE_H + 30}" fill="#57606a" font-size="12" font-weight="600">Language</text>
<text x="${C.stars.x + C.stars.w}" y="${TITLE_H + 30}" text-anchor="end" fill="#57606a" font-size="12" font-weight="600">Stars</text>
<text x="${C.forks.x + C.forks.w}" y="${TITLE_H + 30}" text-anchor="end" fill="#57606a" font-size="12" font-weight="600">Forks</text>
<text x="${C.gain.x + C.gain.w}" y="${TITLE_H + 30}" text-anchor="end" fill="#1a7f37" font-size="12" font-weight="600">↑ ${escSvg(gainHeader)}</text>

${rows}

<!-- bottom border -->
<line x1="0" y1="${totalH - 1}" x2="${W}" y2="${totalH - 1}" stroke="#d0d7de"/>
</svg>`;
}

function escSvg(s: string): string {
    return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

interface Repo {
    nameWithOwner: string;
    owner: string;
    name: string;
    lang: string | null;
    stars: number;
    forks: number;
    periodStars: number;
}

export const route: Route = {
    path: '/trending-chart/:since/:language/:spoken_language?',
    categories: ['programming'],
    example: '/github/trending-chart/weekly/any',
    view: ViewType.Notifications,
    parameters: {
        since: {
            description: 'time range',
            options: [
                { value: 'daily', label: 'Today' },
                { value: 'weekly', label: 'This week' },
                { value: 'monthly', label: 'This month' },
            ],
        },
        language: {
            description: "programming language, use `any` for all. Available in [Trending page](https://github.com/trending)'s URL",
            default: 'any',
        },
        spoken_language: {
            description: "natural language filter, available in [Trending page](https://github.com/trending)'s URL",
        },
    },
    features: {
        requireConfig: [
            {
                name: 'GITHUB_ACCESS_TOKEN',
                description: '',
            },
        ],
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    radar: [
        {
            source: ['github.com/trending'],
            target: '/trending-chart/:since',
        },
    ],
    name: 'Trending Chart',
    maintainers: ['asharca'],
    handler,
    url: 'github.com/trending',
};

async function handler(ctx) {
    if (!config.github?.access_token) {
        throw new ConfigNotFoundError('GitHub trending RSS is disabled due to the lack of <a href="https://docs.rsshub.app/deploy/config#route-specific-configurations">relevant config</a>');
    }

    const since = ctx.req.param('since');
    if (!['daily', 'weekly', 'monthly'].includes(since)) {
        throw new InvalidParameterError(`Invalid since value: ${since}`);
    }
    const rawLanguage = ctx.req.param('language');
    const language = rawLanguage === 'any' ? '' : rawLanguage;
    const spoken_language = ctx.req.param('spoken_language') ?? '';

    const trendingUrl = `https://github.com/trending/${encodeURIComponent(language)}?since=${since}&spoken_language_code=${spoken_language}`;
    const { data: trendingPage } = await got({ method: 'get', url: trendingUrl, headers: { Referer: trendingUrl } });
    const $ = load(trendingPage);

    const trendingRepos = $('article')
        .toArray()
        .map((item) => {
            const [owner, name] = $(item).find('h2').text().split('/');
            // GitHub shows e.g. "1,234 stars this week" / "567 stars today" at the bottom of each card
            const articleText = $(item).text();
            const match = articleText.match(/(\d[\d,]*)\s+stars?\s+(?:this\s+week|this\s+month|today)/i);
            const periodStars = match ? Number.parseInt(match[1].replaceAll(',', ''), 10) : 0;
            return { owner: owner.trim(), name: name.trim(), periodStars };
        })
        .filter(({ owner, name }) => /^[\w.-]+$/.test(owner) && /^[\w.-]+$/.test(name));

    const { data: repoData } = await got({
        method: 'post',
        url: 'https://api.github.com/graphql',
        headers: { Authorization: `bearer ${config.github.access_token}` },
        json: {
            query: /* GraphQL */ `
            query {
            ${trendingRepos
                .map(
                    (repo, i) => `
                _${i}: repository(owner: "${repo.owner}", name: "${repo.name}") {
                    nameWithOwner
                    stargazerCount
                    forkCount
                    primaryLanguage { name }
                }
            `
                )
                .join('')}
            }`,
        },
    });

    const repos: Repo[] = trendingRepos.map(({ periodStars }, i) => {
        const r = repoData.data[`_${i}`] as any;
        return {
            nameWithOwner: r.nameWithOwner,
            owner: r.nameWithOwner.split('/')[0],
            name: r.nameWithOwner.split('/')[1],
            lang: r.primaryLanguage?.name ?? null,
            stars: r.stargazerCount,
            forks: r.forkCount,
            periodStars,
        };
    });

    const label = rawLanguage === 'any' ? 'All Languages' : rawLanguage;
    const title = `GitHub Trending Chart · ${since} · ${label}`;
    const svg = buildSvg(repos, since, rawLanguage);

    // Stable guid within a period: daily=today, weekly=ISO week, monthly=year-month
    const now = new Date();
    const periodKey =
        since === 'monthly'
            ? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
            : since === 'weekly'
              ? (() => {
                    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
                    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
                    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
                    const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
                    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
                })()
              : now.toISOString().slice(0, 10);

    const guid = `github-trending-chart-${since}-${rawLanguage}-${spoken_language}-${periodKey}`;

    return {
        title,
        link: trendingUrl,
        item: [
            {
                guid,
                title,
                description: svg,
                pubDate: now,
                link: trendingUrl,
            },
        ],
    };
}
