import fetch from "node-fetch";
import AWS from "aws-sdk";

// DynamoDB client
const dynamodb = new AWS.DynamoDB.DocumentClient();

// Main Lambda handler
export const handler = async (event) => {
  try {
    // 1. Load Twitter bearer token from DynamoDB
    const params = { TableName: "SecretsTable", Key: { key: "twitter" } };
    const data = await dynamodb.get(params).promise();
    const bearer = data.Item.bearer;

    // 2. Username whose tweets we scan
    const sourceUsername = event.source || "elonmusk";

    // 3. Lookup source user ID
    let res = await fetch(`https://api.twitter.com/2/users/by/username/${sourceUsername}`, {
      headers: { Authorization: `Bearer ${bearer}` }
    });
    let user = await res.json();
    const sourceId = user.data.id;

    // 4. Fetch last 15 tweets with metrics (exclude replies + retweets)
    res = await fetch(
      `https://api.twitter.com/2/users/${sourceId}/tweets?exclude=retweets,replies&max_results=15&tweet.fields=public_metrics`,
      { headers: { Authorization: `Bearer ${bearer}` } }
    );
    let tweets = await res.json();

    if (!tweets.data || tweets.data.length === 0) {
      return { statusCode: 200, body: "No tweets found" };
    }

    // 5. Score tweets
    let bestTweet = tweets.data
      .map(t => {
        const m = t.public_metrics;
        const score = m.like_count + 2 * m.retweet_count + 3 * m.quote_count + 0.5 * m.reply_count;
        return { ...t, score };
      })
      .sort((a, b) => b.score - a.score)[0];

    // 6. Generate simple AI-style comment (stub for now)
    const comment = pickRandomComment(bestTweet.text);

    // 7. Quote-tweet the winner
    res = await fetch("https://api.twitter.com/2/tweets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: comment,
        quote_tweet_id: bestTweet.id
      })
    });
    const result = await res.json();

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Quoted tweet https://twitter.com/${sourceUsername}/status/${bestTweet.id}`,
        comment,
        result
      })
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// Placeholder comment generator
function pickRandomComment(tweetText) {
  const samples = [
    "This is spot on 🚀",
    "Must read 👇",
    "Absolutely true 💯",
    "Love this insight ✨"
  ];
  return samples[Math.floor(Math.random() * samples.length)];
}
