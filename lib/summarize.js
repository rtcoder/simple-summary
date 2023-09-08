'use strict';

const N = 100; // The top N wanted important words to score against
// Threshold for how many words away from currently evaluated word to not count
const CLUSTER_THRESHOLD = 5;


const STOP_WORDS = require('./fixtures/stop-words');
const _ = require('lodash');
const math = require('mathjs');
const nlp = require('nlp_compromise');
const natural = require('natural');
const tokenizer = new natural.TreebankWordTokenizer();

module.exports = function summarize(text) {
    const nlpText = nlp.text(text);

    const sentences = _.map(nlpText.sentences, function (s) {
        return s.str;
    });

    const normalizedSentences = _.map(sentences, function (s) {
        return _.toLower(s);
    });

    const tokenizedSentences = _.map(sentences, function (s) {
        return tokenizer.tokenize(s);
    });

    const words = _.chain(tokenizedSentences)
        .flatten()
        .map(function (word) {
            return _.toLower(word);
        })
        .value();

    let stoppedWords = _.filter(words, function (word) {
        return !(STOP_WORDS.indexOf(word) > -1);
    });

    stoppedWords = _.map(stoppedWords, function (word) {
        return word.replace(/\.$/i, '');
    });

    let fDist = _.reduce(stoppedWords, function (list, word) {
        if (!list[word]) {
            list[word] = {
                word: word,
                count: 1,
            };
            return list;
        }
        list[word].count++;
        return list;
    }, {});

    fDist = _.orderBy(fDist, 'count', 'desc');

    const topNWords = _.take(fDist, N);

    const scores = scoreSentences(normalizedSentences, topNWords);

    const avg = _.meanBy(scores, function (score) {
        return score.score;
    });
    const std = math.std(_(scores)
        .filter()
        .map('score').value());

    // Return anything within half a standard deviation above the mean
    // the score basically means, the higher the % of important words, the better,
    // but if two clusters has the same % of important words, the longer one is
    // better
    const meanScored = _.filter(scores, function (s) {
        return s.score > avg + 0.5 * std;
    });

    const summary = _.map(meanScored, function (score) {
        return sentences[score.index];
    });

    return summary.join('\n');
};

function scoreSentences(sentences, importantWords) {
    return _(sentences)
        .map(function (s) {
            return tokenizer.tokenize(s);
        })
        .map(function (s, i) {
            let wordIndex = [];
            // go through each tokenized sentence, see which important words are in
            // there, return -1 is fine, can filter later
            _.forEach(importantWords, function (w, i) {
                wordIndex.push(s.indexOf(w.word));
            });

            // remove -1's, mutates array
            _.remove(wordIndex, function (i) {
                return i < 0;
            });

            // For sentences that don't have any important words, just ignore
            if (wordIndex.length < 1) {
                return false;
            }

            wordIndex = _.sortBy(wordIndex);

            // Using the word index, compute clusters by using a max distance
            // threshold for any two consecutive words.
            const clusters = [];
            let cluster = [wordIndex[0]];

            for (let x = 1; x < wordIndex.length; x++) {
                // CLUSTER_THRESHOLD is set to 5, this means that the word index of the
                // sentence is the position of the word in that sentence, so we check
                // the distance of words in the sentence and if they're less then 5 away
                // (i.e. [1,3,9]), then first iteration will give 3 - 1 = 2, so we add
                // to cluster, so cluster = [1, 3],
                if (wordIndex[x] - wordIndex[x - 1] < CLUSTER_THRESHOLD) {
                    cluster.push(wordIndex[x]);
                } else {
                    // then in second iteration, we have 9-3 = 6, which is greater than 5
                    // so we append current cluster array to clusters, so we get
                    // clusters=[[1,3]]
                    clusters.push(cluster);
                    // then we add the current word to cluster, so we start new,
                    // so cluster=[9]
                    cluster = [wordIndex[x]];
                }
            }
            clusters.push(cluster);

            // the result is you never have a cluster where each word is more than
            // 5 away from the word before
            // i.e. [[1,3],[9,10,13], [18,20,21,22,24,25]]
            // Score each cluster. The max score for any given cluster is the score
            // for the sentence.

            let maxClusterScore = 0;
            let score;

            _.each(clusters, function (cluster) {
                // get a count of how large cluster is
                const nSigWords = cluster.length;
                // since each cluster is a cluster of indexes and sorted, we can take
                // the last element and subtract the first to get the number of words
                // in cluster
                // so [1,3]=3-1+1=3, and [9,10,13]=13-9+1=5
                // i think what's happening here is we're trying to get clusters of
                // parts of the sentences, including non-important words, and each
                // cluster starts and stops with an important word
                // but clusters are also split by having too many non-important words
                // between them
                const totalClusterWords = cluster[cluster.length - 1] - cluster[0] +
                    1;
                score = 1.0 * nSigWords * nSigWords / totalClusterWords;
                if (score > maxClusterScore) {
                    maxClusterScore = score;
                }
                // for each sentence, we find the highest score in all the clusters
            });

            return {
                score: maxClusterScore,
                index: i,
            };

        }).value();
}
