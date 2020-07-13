require('dotenv').config();

const request = require('request');
const { CommentStream } = require("snoostorm");
const Snoowrap = require('snoowrap');
const BOT_START = Date.now()/1000;

const reddit = new Snoowrap({ // connection credentials in .env
	userAgent: 'PictureGameOlympiad-bot',
	clientId: process.env.CLIENT_ID,
	clientSecret: process.env.CLIENT_SECRET,
	username: process.env.REDDIT_USER,
	password: process.env.REDDIT_PASS
});

const stream = new CommentStream(reddit, { subreddit: "PictureGame", limit: 5, polltime: 10000 }); // listen to /r/PictureGame

const startDate = '2020-07-24T00:00:00';
const endDate = '2020-08-09T23:59:59';
const teamsThread = 'gnxm5z'; // reddit post id containing the teams
const leaderboardComment = 'fx3eva5'; // reddit comment where the leaderboard is displayed/updated
const playersToShow = 10;

const leaderboardAPI = 'https://api.picturegame.co/leaderboard?filterRounds=postTime%20gte%20'+startDate+'%20and%20postTime%20lt%20'+endDate;

var teams = {};
var players = {};

init();

function init() {
	getTeams();
	setTimeout(updateLeaderboard,10000);
}

function setTeam(comment) { // parse team comment to get team name and participants
	try {
		var parts = comment.body.split('\n');
		var teamParts = parts[0].match(/#(.+) \[(\w+)\]/);
		teams[teamParts[2]] = { 'name': teamParts[1], 'score': 0, players: [] };
		var usernames = parts[1].split(' ');
		for (var i=0;i<usernames.length;i++) if (!(usernames[i] in players)) players[usernames[i]] = { 'team': teamParts[2] };
	} catch (err) { console.log('**ERROR** CANNOT CREATE TEAM: '+comment.body); }
}

function getTeams() { // get teams posted as comments in teamsThread
	console.log('setting teams');
	teams = {};
	players = {};
	reddit.getSubmission(teamsThread).expandReplies({'limit':25, 'depth':1}).then(thread => { thread.comments.forEach((comment) => setTeam(comment))});
	setTimeout(getTeams,300000);
}

stream.on("item", item => { // new post on /r/PictureGame
	if(item.created_utc < BOT_START) return;
	try {
		if ((item.author.name === 'r-PictureGame') && (item.body.indexOf('Congratulations, that was the correct answer!')==0)) { // check that round is over (comment from auto-bot)
			console.log('round over '+item.link_title);
			updateLeaderboard();
		}
	} catch (err) { /* possible timeout or rate-limit, ignore */ }
});

function callAPI(url) { return { url: url, headers: { 'User-Agent': reddit.userAgent } }; }

function getTeam(username) { if (username in players) return ' ['+players[username].team+']'; return ''; } // returns a user's team (if any)

function getMedal(i) { switch(i) { case 0: return '🥇 '; case 1: return '🥈 '; case 2: return '🥉 '; } return ''; } // returns gold/silver/bronze medal emoji

function updateLeaderboard() { // update leaderboard comment
	request.get(callAPI(leaderboardAPI), function (error, response, body) { // fetch current official PictureGame leaderboard
		if (!error && response.statusCode == 200) {
			var data = JSON.parse(body);
			for (var key in teams) { teams[key].score = 0; teams[key].players = []; }
			var teamString = 'Rank |Team | Wins | Team leader\n---:|---|---:|---\n';
			var playerString = 'Rank |Player | Wins\n---:|---|---:\n';
			var maxRound = 0;
			var topWins = 0;
			var totalWins = 0;
			var noTeam = 0;
			var noTeamPlayers = [];
			for (var i=0;i<data.leaderboard.length;i++) { // loop over every player from the leaderboard and update teams scores
				if (i<playersToShow) {
					playerString += '\\#'+(i+1)+' |'+getMedal(i)+data.leaderboard[i].username+getTeam(data.leaderboard[i].username)+' |'+data.leaderboard[i].numWins+'\n';
					topWins += data.leaderboard[i].numWins;
				}
				totalWins += data.leaderboard[i].numWins;
				if (data.leaderboard[i].roundList[data.leaderboard[i].roundList.length-1]>maxRound)
					maxRound = data.leaderboard[i].roundList[data.leaderboard[i].roundList.length-1];
				if (data.leaderboard[i].username in players) {
					teams[players[data.leaderboard[i].username].team].score += data.leaderboard[i].numWins;
					teams[players[data.leaderboard[i].username].team].players.push({ 'name': data.leaderboard[i].username, 'wins': data.leaderboard[i].numWins });
				} else {
					noTeam += data.leaderboard[i].numWins;
					noTeamPlayers.push({ 'name': data.leaderboard[i].username, 'wins': data.leaderboard[i].numWins });
				}
			}
			if (data.leaderboard.length>playersToShow) playerString += ' |'+(data.leaderboard.length-playersToShow)+' other players |'+(totalWins-topWins)+'\n';
			var teamsArray = [];
			for (var key in teams) teamsArray.push({ 'key': key, 'score': teams[key].score});
			teamsArray.sort(function(a,b) { return a.score>b.score?-1:1; });
			for (var i=0;i<teamsArray.length;i++)
				teamString += '\\#'+(i+1)+' |'+getMedal(i)+teams[teamsArray[i].key].name+' ['+teamsArray[i].key+'] |'+teamsArray[i].score+' |'+(teams[teamsArray[i].key].players.length>0?(teams[teamsArray[i].key].players[0].name+' ('+teams[teamsArray[i].key].players[0].wins+' wins)'):'')+'\n';
			if (noTeam>0) teamString += ' |No team |'+noTeam+' |'+noTeamPlayers[0].name+' ('+noTeamPlayers[0].wins+' wins)'+'\n';
			teamString += ' |Total |'+totalWins+' |\n';
			reddit.getComment(leaderboardComment).edit('#Leaderboard from July 24th 2020 to August 9th 2020\n##Teams:\n'+teamString+'\n----\n##Players:\n'+playerString+'\n\nlast update: round '+maxRound); // update comment on reddit
			console.log('leaderboard updated');
		} else {
			console.log('error calling: '+leaderboardAPI);
			console.log(error);
		}
	});
}
