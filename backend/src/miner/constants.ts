// Ported from TwitchChannelPointsMiner/constants.py
export const TWITCH_URL = 'https://www.twitch.tv';
export const PUBSUB_WS_URL = 'wss://pubsub-edge.twitch.tv/v1';
export const GQL_URL = 'https://gql.twitch.tv/gql';

// "TV" client id — same as used by the Python miner
export const CLIENT_ID = 'ue6666qo983tsx6so1t0vnawi233wa';
export const CLIENT_VERSION = 'ef928475-9403-42f2-8a34-55784bd08e16';

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36';

// Persisted GraphQL queries — sha256 hashes lifted verbatim.
// If Twitch rotates them, update here.
export const GQL = {
  GetIDFromLogin: {
    operationName: 'GetIDFromLogin',
    sha256: '94e82a7b1e3c21e186daa73ee2afc4b8f23bade1fbbff6fe8ac133f50a2f58ca',
  },
  VideoPlayerStreamInfoOverlayChannel: {
    operationName: 'VideoPlayerStreamInfoOverlayChannel',
    sha256: '198492e0857f6aedead9665c81c5a06d67b25b58034649687124083ff288597d',
  },
  ChannelPointsContext: {
    operationName: 'ChannelPointsContext',
    sha256: '1530a003a7d374b0380b79db0be0534f30ff46e61cffa2bc0e2468a909fbc024',
  },
  ClaimCommunityPoints: {
    operationName: 'ClaimCommunityPoints',
    sha256: '46aaeebe02c99afdf4fc97c7c0cba964124bf6b0af229395f1f6d1feed05b3d0',
  },
  MakePrediction: {
    operationName: 'MakePrediction',
    sha256: 'b44682ecc88358817009f20e69d75081b1e58825bb40aa53d5dbadcc17c881d8',
  },
  PlaybackAccessToken: {
    operationName: 'PlaybackAccessToken',
    sha256: '3093517e37e4f4cb48906155bcd894150aef92617939236d2508f3375ab732ce',
  },
  WithIsStreamLiveQuery: {
    operationName: 'WithIsStreamLiveQuery',
    sha256: '04e46329a6786ff3a81c01c50bfa5d725902507a0deb83b0edbf7abe7a3716ea',
  },
  ChannelFollows: {
    operationName: 'ChannelFollows',
    sha256: 'eecf815273d3d949e5cf0085cc5084cd8a1b5b7b6f7990cf43cb0beadf546907',
  },
} as const;

export type GqlOpName = keyof typeof GQL;
