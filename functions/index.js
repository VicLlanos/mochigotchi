const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

/**
 * Watches for new diary entries and sends a push notification to the partner.
 * Region must match your Realtime Database region: asia-southeast1
 */
exports.notifyPartnerOnDiaryEntry = functions
  .region('asia-southeast1')
  .database
  .ref('/tamagotchi/diary/{entryId}')
  .onCreate(async (snapshot, context) => {
    const entry = snapshot.val();
    if (!entry || !entry.by || !entry.text) return null;

    const author = entry.by;
    const partner = author === 'koy' ? 'metz' : 'koy';
    const authorName = author === 'koy' ? '🌿 Koy' : '🌸 Metz';

    // Fetch partner token
    const tokenSnap = await admin.database()
      .ref('/tamagotchi/fcmTokens/' + partner + '/token')
      .once('value');
    const token = tokenSnap.val();

    if (!token) {
      console.log('No FCM token for ' + partner + ', skipping');
      return null;
    }

    const bodyText = entry.text.charAt(0).toUpperCase() + entry.text.slice(1);

    const message = {
      token: token,
      notification: {
        title: authorName + ' cared for Mochi',
        body: bodyText
      },
      data: {
        tag: 'mochi-diary',
        entryId: context.params.entryId,
        action: 'open_diary'
      },
      webpush: {
        notification: {
          icon: './icon-192.png',
          badge: './icon-192.png',
          tag: 'mochi-diary',
          renotify: false
        },
        fcmOptions: {
          link: './index.html'
        }
      }
    };

    try {
      const response = await admin.messaging().send(message);
      console.log('Notification sent:', response);
      return response;
    } catch (err) {
      console.error('FCM send error:', err);
      if (err.code === 'messaging/registration-token-not-registered') {
        await admin.database().ref('/tamagotchi/fcmTokens/' + partner).remove();
      }
      return null;
    }
  });