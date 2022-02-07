/**
 *
 * From permalink:  https://github.com/launchdarkly/js-client-sdk/blob/a486f271a317b5458db974f21b9c11a6681fd0f4/src/GoalTracker.js
 */

function escapeStringRegexp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function doesUrlMatch(matcher, href, search, hash) {
  const keepHash = (matcher.kind === 'substring' || matcher.kind === 'regex') && hash.includes('/');
  const canonicalUrl = (keepHash ? href : href.replace(hash, '')).replace(search, '');

  let regex;
  let testUrl;

  switch (matcher.kind) {
    case 'exact':
      testUrl = href;
      regex = new RegExp('^' + escapeStringRegexp(matcher.url) + '/?$');
      break;
    case 'canonical':
      testUrl = canonicalUrl;
      regex = new RegExp('^' + escapeStringRegexp(matcher.url) + '/?$');
      break;
    case 'substring':
      testUrl = canonicalUrl;
      regex = new RegExp('.*' + escapeStringRegexp(matcher.substring) + '.*$');
      break;
    case 'regex':
      testUrl = canonicalUrl;
      regex = new RegExp(matcher.pattern);
      break;
    default:
      return false;
  }
  return regex.test(testUrl);
}
