INSERT INTO subscribers VALUES (1, 'local test', 'push,pull_request');
INSERT INTO subscribers VALUES (2, 'another test', 'check_run');
INSERT INTO subscribers VALUES (3, 'other test', 'repository.created');
INSERT INTO transports VALUES (1, 1, 'http', '{"url":"http://localhost:3000/api/github/webhooks","webhook_secret":"bazqux123456"}');
