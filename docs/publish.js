const ghpages = require('gh-pages');
const path = require('path');

ghpages.publish(path.resolve(__dirname, '../out/docs'), {
	src: ['**/*', '*'],
	logger: function(message) {
		console.log(message);
	}
}, (err)=> {
	if (err) {
		console.error(err);
		process.exit(1);
	}
	console.log('published docs!');
});
