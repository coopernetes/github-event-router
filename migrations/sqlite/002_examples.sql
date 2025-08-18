INSERT INTO subscribers VALUES (1, 'local test service', 'push,pull_request');
INSERT INTO subscribers VALUES (2, 'ci/cd service', 'push,check_run');
INSERT INTO subscribers VALUES (3, 'analytics service', 'push,pull_request,issues');
INSERT INTO transports VALUES (1, 1, 'https', '{"url":"http://localhost:3000/api/github/webhooks","webhook_secret":"bazqux123456"}');
INSERT INTO transports VALUES (2, 2, 'https', '{"url":"http://localhost:3001/api/github/webhooks","webhook_secret":"bazqux123456"}');
INSERT INTO transports VALUES (3, 3, 'https', '{"url":"http://localhost:3002/api/github/webhooks","webhook_secret":"bazqux123456"}');
