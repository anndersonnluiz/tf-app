var app = angular.module('tfApp', []);

function getApiBaseUrl() {
  var configuredUrl = window.TF_API_URL || 'http://localhost:3000';
  return configuredUrl.replace(/\/$/, '');
}

function getHelpPageUrl() {
  return window.TF_HELP_URL ||
    new URLSearchParams(window.location.search).get('helpUrl') ||
    'https://anndersonnluiz.github.io/tf-landing-page/';
}

function getRoomCodeFromUrl() {
  var roomCode = new URLSearchParams(window.location.search).get('roomCode');
  return roomCode ? roomCode.trim().toUpperCase() : '';
}

app.factory('socket', function($rootScope) {
  var socket = io.connect(getApiBaseUrl());

  return {
    id: function() {
      return socket.id;
    },
    on: function(eventName, callback) {
      socket.on(eventName, function() {
        var args = arguments;
        $rootScope.$apply(function() {
          callback.apply(socket, args);
        });
      });
    },
    emit: function(eventName, data, callback) {
      socket.emit(eventName, data, function() {
        var args = arguments;
        $rootScope.$apply(function() {
          if (callback) {
            callback.apply(socket, args);
          }
        });
      });
    }
  };
});

app.controller('LobbyController', function($scope, $timeout, socket) {
  $scope.currentView = 'login';
  $scope.data = {
    playerName: window.localStorage.getItem('tfPlayerName') || '',
    roomCodeInput: getRoomCodeFromUrl()
  };

  $scope.currentRoomCode = '';
  $scope.players = [];
  $scope.playerStates = [];
  $scope.currentRound = 0;
  $scope.currentTrump = null;
  $scope.cardsPerPlayer = 5;
  $scope.myHand = [];
  $scope.tableCards = [];
  $scope.roomStatus = '';
  $scope.isMyTurn = false;
  $scope.pendingPlayCard = null;
  $scope.betValue = 0;
  $scope.betError = '';
  $scope.roundHistory = [];
  $scope.showHistoryPanel = false;
  $scope.toastMessage = null;
  $scope.toastClass = '';
  $scope.roundResults = [];
  $scope.gameOver = null;
  $scope.rematch = {
    acceptedPlayers: [],
    totalPlayers: 0,
    requestedBy: '',
    hasRequested: false
  };
  $scope.message = '';
  $scope.messageType = 'success';
  $scope.soundEnabled = window.localStorage.getItem('tfSoundEnabled') !== 'false';
  $scope.gameSummary = null;
  $scope.quickChatOpen = false;
  $scope.quickChatCooldownUntil = 0;
  $scope.quickChatFeed = [];
  $scope.quickChatToast = null;
  $scope.quickChatEmojis = ['👏', '😅', '🔥', '😎', '🤝', '😬'];
  $scope.quickChatPhrases = [
    'Boa!',
    'Bucha!',
    'Agora vai.',
    'Segura essa.',
    'Tô pensando...',
    'Última carta!'
  ];

  var messageTimeout;
  var audioContext = null;
  var lastTurnAlertKey = '';
  var hasUnlockedAudio = false;
  var quickChatCooldownTimer = null;
  var quickChatToastTimer = null;

  function savePlayerName() {
    window.localStorage.setItem('tfPlayerName', ($scope.data.playerName || '').trim());
  }

  function saveSoundPreference() {
    window.localStorage.setItem('tfSoundEnabled', String($scope.soundEnabled));
  }

  function getAudioContext() {
    if (!audioContext) {
      var AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        return null;
      }

      audioContext = new AudioContextClass();
    }

    return audioContext;
  }

  function unlockAudio() {
    var context = getAudioContext();

    if (!context) {
      return Promise.resolve(false);
    }

    if (context.state === 'running') {
      hasUnlockedAudio = true;
      return Promise.resolve(true);
    }

    return context.resume()
      .then(function() {
        hasUnlockedAudio = true;
        return true;
      })
      .catch(function() {
        return false;
      });
  }

  function playToneSequence(sequence, options) {
    if (!$scope.soundEnabled || !hasUnlockedAudio) {
      return;
    }

    var context = getAudioContext();
    if (!context || context.state !== 'running') {
      return;
    }

    var settings = options || {};
    var startAt = context.currentTime + (settings.delay || 0);
    var masterGain = context.createGain();
    masterGain.gain.value = settings.volume || 0.045;
    masterGain.connect(context.destination);

    sequence.forEach(function(note, index) {
      var oscillator = context.createOscillator();
      var gainNode = context.createGain();
      var noteStart = startAt + (note.at || 0);
      var duration = note.duration || 0.12;
      var noteEnd = noteStart + duration;

      oscillator.type = note.type || settings.type || 'sine';
      oscillator.frequency.setValueAtTime(note.frequency, noteStart);
      if (note.slideTo) {
        oscillator.frequency.linearRampToValueAtTime(note.slideTo, noteEnd);
      }

      gainNode.gain.setValueAtTime(0.0001, noteStart);
      gainNode.gain.linearRampToValueAtTime(note.gain || 0.9, noteStart + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, noteEnd);

      oscillator.connect(gainNode);
      gainNode.connect(masterGain);
      oscillator.start(noteStart);
      oscillator.stop(noteEnd + 0.02 + (index * 0.001));
    });
  }

  function playSound(type, payload) {
    if (!$scope.soundEnabled) {
      return;
    }

    switch (type) {
      case 'turn':
        playToneSequence([
          { frequency: 587.33, duration: 0.11, at: 0, type: 'triangle' },
          { frequency: 783.99, duration: 0.16, at: 0.12, type: 'triangle' }
        ], { volume: 0.04 });
        break;
      case 'cardPlayed':
        playToneSequence([
          { frequency: 246.94, duration: 0.05, at: 0, type: 'square', gain: 0.55 },
          { frequency: 329.63, duration: 0.07, at: 0.04, type: 'triangle', gain: 0.45 }
        ], { volume: 0.04 });
        break;
      case 'betReady':
        playToneSequence([
          { frequency: 440, duration: 0.08, at: 0, type: 'triangle' },
          { frequency: 523.25, duration: 0.12, at: 0.09, type: 'triangle' }
        ], { volume: 0.035 });
        break;
      case 'trickTie':
        playToneSequence([
          { frequency: 210, duration: 0.08, at: 0, type: 'sawtooth', gain: 0.5 },
          { frequency: 180, duration: 0.1, at: 0.1, type: 'sawtooth', gain: 0.45 }
        ], { volume: 0.05 });
        break;
      case 'trickWon':
        playToneSequence([
          { frequency: 523.25, duration: 0.08, at: 0, type: 'triangle' },
          { frequency: 659.25, duration: 0.1, at: 0.09, type: 'triangle' },
          { frequency: 783.99, duration: 0.16, at: 0.2, type: 'triangle' }
        ], { volume: payload && payload.isMine ? 0.05 : 0.035 });
        break;
      case 'roundStart':
        playToneSequence([
          { frequency: 392, duration: 0.08, at: 0, type: 'sine' },
          { frequency: 523.25, duration: 0.1, at: 0.08, type: 'sine' },
          { frequency: 659.25, duration: 0.14, at: 0.18, type: 'sine' }
        ], { volume: 0.038 });
        break;
      case 'gameWon':
        playToneSequence([
          { frequency: 523.25, duration: 0.12, at: 0, type: 'triangle' },
          { frequency: 659.25, duration: 0.12, at: 0.11, type: 'triangle' },
          { frequency: 783.99, duration: 0.14, at: 0.22, type: 'triangle' },
          { frequency: 1046.5, duration: 0.28, at: 0.36, type: 'triangle' }
        ], { volume: 0.05 });
        break;
      case 'gameLost':
        playToneSequence([
          { frequency: 392, duration: 0.12, at: 0, type: 'sine' },
          { frequency: 329.63, duration: 0.14, at: 0.12, type: 'sine' },
          { frequency: 261.63, duration: 0.24, at: 0.27, type: 'sine' }
        ], { volume: 0.04 });
        break;
      case 'quickChat':
        playToneSequence([
          { frequency: 740, duration: 0.06, at: 0, type: 'triangle', gain: 0.45 },
          { frequency: 988, duration: 0.08, at: 0.07, type: 'triangle', gain: 0.38 }
        ], { volume: payload && payload.isMine ? 0.028 : 0.035 });
        break;
      default:
        break;
    }
  }

  function buildTurnAlertKey() {
    return [
      $scope.currentView,
      $scope.roomStatus,
      $scope.currentRound,
      $scope.isMyTurn ? 'mine' : 'wait',
      ($scope.myHand || []).length
    ].join(':');
  }

  function maybePlayTurnAlert() {
    if (!$scope.isMyTurn) {
      lastTurnAlertKey = '';
      return;
    }

    if ($scope.roomStatus !== 'BETTING' && $scope.roomStatus !== 'PLAYING') {
      return;
    }

    var alertKey = buildTurnAlertKey();
    if (alertKey === lastTurnAlertKey) {
      return;
    }

    lastTurnAlertKey = alertKey;
    playSound($scope.roomStatus === 'BETTING' ? 'betReady' : 'turn');
  }

  function buildGameSummary(playerStates) {
    var ranking = (playerStates || []).slice().sort(function(a, b) {
      if ((b.lives || 0) !== (a.lives || 0)) {
        return (b.lives || 0) - (a.lives || 0);
      }

      return (b.tricksWon || 0) - (a.tricksWon || 0);
    });

    var mostLives = ranking.length ? ranking[0] : null;
    var mostTricks = ranking.slice().sort(function(a, b) {
      if ((b.tricksWon || 0) !== (a.tricksWon || 0)) {
        return (b.tricksWon || 0) - (a.tricksWon || 0);
      }

      return (b.lives || 0) - (a.lives || 0);
    })[0] || null;
    var survivors = ranking.filter(function(player) {
      return (player.lives || 0) > 0;
    });
    var champion = survivors.length ? survivors[0] : null;

    return {
      totalRounds: $scope.currentRound || 0,
      players: ranking,
      champion: champion,
      mostLives: survivors.length ? mostLives : null,
      mostTricks: mostTricks,
      survivorCount: survivors.length
    };
  }

  function updateUrlWithRoomCode(roomCode) {
    var url = new URL(window.location.href);

    if (roomCode) {
      url.searchParams.set('roomCode', roomCode);
    } else {
      url.searchParams.delete('roomCode');
    }

    window.history.replaceState({}, '', url.toString());
  }

  function getInviteLink(roomCode) {
    var url = new URL(window.location.href);
    url.searchParams.set('roomCode', roomCode);
    return url.toString();
  }

  function getInviteMessage(roomCode) {
    var inviteLink = getInviteLink(roomCode);

    return [
      'Bora jogar Tenha Fé?',
      '',
      'Entre na minha sala usando este código: ' + roomCode,
      inviteLink
    ].join('\n');
  }

  function canUseNativeShare() {
    return !!(navigator.share && $scope.currentRoomCode);
  }

  function clearQuickChatState() {
    if (quickChatCooldownTimer) {
      $timeout.cancel(quickChatCooldownTimer);
      quickChatCooldownTimer = null;
    }

    if (quickChatToastTimer) {
      $timeout.cancel(quickChatToastTimer);
      quickChatToastTimer = null;
    }

    $scope.quickChatOpen = false;
    $scope.quickChatCooldownUntil = 0;
    $scope.quickChatFeed = [];
    $scope.quickChatToast = null;
  }

  function addQuickChatMessage(entry) {
    if (!entry || !entry.message) {
      return;
    }

    $scope.quickChatFeed = ($scope.quickChatFeed || []).concat([entry]).slice(-8);
  }

  function resetToLobby() {
    $scope.currentView = 'login';
    $scope.currentRoomCode = '';
    $scope.players = [];
    $scope.playerStates = [];
    $scope.currentRound = 0;
    $scope.currentTrump = null;
    $scope.cardsPerPlayer = 5;
    $scope.myHand = [];
    $scope.tableCards = [];
    $scope.roomStatus = '';
    $scope.isMyTurn = false;
    $scope.pendingPlayCard = null;
    $scope.betValue = 0;
    $scope.betError = '';
    $scope.roundHistory = [];
    $scope.showHistoryPanel = false;
    $scope.toastMessage = null;
    $scope.toastClass = '';
    $scope.roundResults = [];
    $scope.gameOver = null;
    $scope.gameSummary = null;
    clearQuickChatState();
    $scope.rematch = {
      acceptedPlayers: [],
      totalPlayers: 0,
      requestedBy: '',
      hasRequested: false
    };
    $scope.message = '';
    $scope.data.roomCodeInput = getRoomCodeFromUrl();
  }

  function updatePlayerStates(playerStates) {
    if (playerStates) {
      $scope.playerStates = playerStates;
    }
  }

  function getMyPlayerState() {
    return ($scope.playerStates || []).find(function(player) {
      return player.name === $scope.data.playerName.trim();
    });
  }

  function syncTurnState(data) {
    if (data && data.status) {
      $scope.roomStatus = data.status;
    }

    updatePlayerStates(data && data.playerStates);

    var myPlayerState = getMyPlayerState();
    var isMyTurnBySocket = !!(data && data.currentPlayerId) && socket.id() === data.currentPlayerId;
    var isMyTurnByState = !!(myPlayerState && myPlayerState.isCurrentTurn);

    $scope.isMyTurn = isMyTurnBySocket || isMyTurnByState;

    if ($scope.isMyTurn) {
      $scope.betError = '';
      var minimumBet = myPlayerState ? (myPlayerState.guaranteedTricks || 0) : 0;
      if ($scope.betValue < minimumBet) {
        $scope.betValue = minimumBet;
      }
    }

    maybePlayTurnAlert();
  }

  function getMaxBetValue() {
    return ($scope.myHand && $scope.myHand.length) ? $scope.myHand.length : $scope.cardsPerPlayer;
  }

  function showMessage(message, type) {
    $scope.message = message;
    $scope.messageType = type || 'success';

    if (messageTimeout) {
      $timeout.cancel(messageTimeout);
    }

    messageTimeout = $timeout(function() {
      $scope.message = '';
    }, 4000);
  }

  $scope.copyInviteLink = function() {
    if (!$scope.currentRoomCode) {
      return;
    }

    var inviteLink = getInviteLink($scope.currentRoomCode);

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(inviteLink)
        .then(function() {
          showMessage('Link de convite copiado!', 'success');
        })
        .catch(function() {
          showMessage('Não foi possível copiar o link agora.', 'error');
        });
      return;
    }

    showMessage('Copie este link: ' + inviteLink, 'success');
  };

  $scope.getInviteLink = function() {
    return $scope.currentRoomCode ? getInviteLink($scope.currentRoomCode) : '';
  };

  $scope.copyInviteMessage = function() {
    if (!$scope.currentRoomCode) {
      return;
    }

    var inviteMessage = getInviteMessage($scope.currentRoomCode);

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(inviteMessage)
        .then(function() {
          showMessage('Mensagem de convite copiada!', 'success');
        })
        .catch(function() {
          showMessage('Não foi possível copiar a mensagem agora.', 'error');
        });
      return;
    }

    showMessage('Copie esta mensagem: ' + inviteMessage, 'success');
  };

  $scope.canUseNativeShare = function() {
    return canUseNativeShare();
  };

  $scope.shareInvite = function() {
    if (!canUseNativeShare()) {
      $scope.copyInviteMessage();
      return;
    }

    var roomCode = $scope.currentRoomCode;
    var inviteLink = getInviteLink(roomCode);

    navigator.share({
      title: 'Tenha Fé',
      text: 'Bora jogar Tenha Fé? Entre na minha sala com o código ' + roomCode + '.',
      url: inviteLink
    }).then(function() {
      showMessage('Convite compartilhado!', 'success');
    }).catch(function(error) {
      if (error && error.name === 'AbortError') {
        return;
      }

      $scope.copyInviteMessage();
    });
  };

  $scope.shareInviteViaWhatsApp = function() {
    if (!$scope.currentRoomCode) {
      return;
    }

    var inviteMessage = getInviteMessage($scope.currentRoomCode);
    var whatsappUrl = 'https://wa.me/?text=' + encodeURIComponent(inviteMessage);
    window.open(whatsappUrl, '_blank', 'noopener');
  };

  $scope.toggleSound = function() {
    $scope.soundEnabled = !$scope.soundEnabled;
    saveSoundPreference();

    if ($scope.soundEnabled) {
      unlockAudio().then(function(unlocked) {
        if (unlocked) {
          playSound('turn');
        }
      });
    }
  };

  $scope.openHelpPage = function() {
    window.open(getHelpPageUrl(), '_blank', 'noopener');
  };

  $scope.toggleQuickChat = function() {
    $scope.quickChatOpen = !$scope.quickChatOpen;
  };

  $scope.closeQuickChat = function() {
    $scope.quickChatOpen = false;
  };

  $scope.canSendQuickChat = function() {
    return !!$scope.currentRoomCode && Date.now() >= $scope.quickChatCooldownUntil;
  };

  $scope.sendQuickChat = function(message) {
    if (!$scope.currentRoomCode || !message || !$scope.canSendQuickChat()) {
      return;
    }

    unlockAudio();
    $scope.quickChatCooldownUntil = Date.now() + 1500;
    if (quickChatCooldownTimer) {
      $timeout.cancel(quickChatCooldownTimer);
    }

    quickChatCooldownTimer = $timeout(function() {
      $scope.quickChatCooldownUntil = 0;
      quickChatCooldownTimer = null;
    }, 1500);

    socket.emit('send_quick_chat', {
      roomCode: $scope.currentRoomCode,
      message: message
    });
  };

  $scope.closeHistory = function() {
    $scope.showHistoryPanel = false;
  };

  $scope.toggleHistory = function() {
    if (!$scope.roundHistory || !$scope.roundHistory.length) {
      showMessage('O histórico aparece depois que a primeira vaza é resolvida.', 'error');
      return;
    }

    $scope.showHistoryPanel = !$scope.showHistoryPanel;
  };

  $scope.playAgain = function() {
    if (!$scope.currentRoomCode || $scope.rematch.hasRequested) {
      return;
    }

    unlockAudio();
    $scope.rematch.hasRequested = true;
    socket.emit('request_rematch', { roomCode: $scope.currentRoomCode });
  };

  $scope.leaveToLobby = function() {
    updateUrlWithRoomCode('');
    resetToLobby();
    showMessage('Você voltou para a tela inicial.', 'success');
  };

  $scope.quickMatch = function() {
    if (!$scope.data.playerName || !$scope.data.playerName.trim()) {
      showMessage('Por favor, digite seu apelido antes de jogar.', 'error');
      return;
    }

    savePlayerName();
    unlockAudio();
    socket.emit('quick_match', { playerName: $scope.data.playerName.trim() });
  };

  $scope.createRoom = function() {
    if (!$scope.data.playerName || !$scope.data.playerName.trim()) {
      showMessage('Por favor, digite seu apelido antes de criar uma sala.', 'error');
      return;
    }

    savePlayerName();
    unlockAudio();
    socket.emit('create_room', {
      playerName: $scope.data.playerName.trim(),
      isPrivate: true
    });
  };

  $scope.joinRoom = function() {
    if (!$scope.data.playerName || !$scope.data.playerName.trim()) {
      showMessage('Por favor, digite seu apelido antes de entrar.', 'error');
      return;
    }

    if (!$scope.data.roomCodeInput || $scope.data.roomCodeInput.trim().length !== 4) {
      showMessage('O código da sala deve ter exatamente 4 caracteres.', 'error');
      return;
    }

    savePlayerName();
    unlockAudio();
    socket.emit('join_room', {
      playerName: $scope.data.playerName.trim(),
      roomCode: $scope.data.roomCodeInput.trim().toUpperCase()
    });
  };

  $scope.startGame = function() {
    if (!$scope.currentRoomCode) {
      return;
    }

    if (!$scope.players || $scope.players.length < 2) {
      showMessage('A partida precisa de pelo menos 2 jogadores para iniciar.', 'error');
      return;
    }

    unlockAudio();
    socket.emit('start_game', { roomCode: $scope.currentRoomCode });
  };

  $scope.incrementBet = function() {
    if ($scope.betValue < getMaxBetValue()) {
      $scope.betValue += 1;
      $scope.betError = '';
    }
  };

  $scope.decrementBet = function() {
    if ($scope.betValue > 0) {
      $scope.betValue -= 1;
      $scope.betError = '';
    }
  };

  $scope.makeBet = function() {
    var myPlayerState = getMyPlayerState();
    var guaranteedTricks = myPlayerState ? (myPlayerState.guaranteedTricks || 0) : 0;

    if ($scope.betValue > getMaxBetValue()) {
      $scope.betValue = getMaxBetValue();
    }

    if ($scope.betValue < guaranteedTricks) {
      $scope.betError = 'Você precisa apostar pelo menos ' + guaranteedTricks + '.';
      return;
    }

    unlockAudio();
    socket.emit('make_bet', {
      roomCode: $scope.currentRoomCode,
      bet: $scope.betValue
    });
  };

  $scope.playCard = function(card) {
    if (!$scope.isMyTurn || $scope.roomStatus !== 'PLAYING' || $scope.pendingPlayCard) {
      return;
    }

    unlockAudio();
    playSound('cardPlayed');
    $scope.pendingPlayCard = card;
    $scope.isMyTurn = false;

    socket.emit('play_card', {
      roomCode: $scope.currentRoomCode,
      card: card
    });
  };

  socket.on('room_created', function(data) {
    $scope.showHistoryPanel = false;
    clearQuickChatState();
    $scope.currentView = 'room';
    $scope.currentRoomCode = data.roomCode;
    updateUrlWithRoomCode(data.roomCode);
    showMessage('Sala criada com sucesso!', 'success');
  });

  socket.on('room_joined', function(data) {
    $scope.showHistoryPanel = false;
    clearQuickChatState();
    $scope.currentView = 'room';
    $scope.currentRoomCode = data.roomCode;
    updateUrlWithRoomCode(data.roomCode);
    showMessage('Conectado à sala com sucesso!', 'success');
  });

  socket.on('room_updated', function(data) {
    $scope.players = data.players || [];
    syncTurnState(data);
  });

  socket.on('round_started', function(data) {
    $scope.players = data.players || $scope.players;
    $scope.currentView = 'table';
    $scope.roomStatus = 'BETTING';
    $scope.currentRound = data.round || 1;
    $scope.cardsPerPlayer = data.cardsPerPlayer || 5;
    $scope.currentTrump = data.trump;
    $scope.betValue = 0;
    $scope.betError = '';
    $scope.roundHistory = [];
    $scope.tableCards = [];
    $scope.pendingPlayCard = null;
    $scope.gameOver = null;
    $scope.gameSummary = null;
    clearQuickChatState();
    $scope.rematch = {
      acceptedPlayers: [],
      totalPlayers: 0,
      requestedBy: '',
      hasRequested: false
    };
    syncTurnState(data);
    var myPlayerState = getMyPlayerState();
    $scope.betValue = myPlayerState ? (myPlayerState.guaranteedTricks || 0) : 0;
    playSound('roundStart');
    showMessage('Fase de apostas iniciada!', 'success');
  });

  socket.on('turn_update', function(data) {
    syncTurnState(data);
  });

  socket.on('playing_started', function(data) {
    $scope.pendingPlayCard = null;
    syncTurnState(data);
    showMessage(data.message, 'success');
  });

  socket.on('bet_error', function(data) {
    $scope.betError = data.message;
  });

  socket.on('hand_dealt', function(data) {
    $scope.myHand = data.hand || [];
    $scope.pendingPlayCard = null;
  });

  socket.on('table_updated', function(data) {
    $scope.tableCards = data.tableCards || [];

    if ($scope.pendingPlayCard) {
      var playedCardConfirmed = $scope.tableCards.some(function(tableCard) {
        return (
          tableCard.playerName === $scope.data.playerName.trim() &&
          tableCard.card &&
          tableCard.card.value === $scope.pendingPlayCard.value &&
          tableCard.card.suit === $scope.pendingPlayCard.suit
        );
      });

      if (playedCardConfirmed) {
        $scope.myHand = ($scope.myHand || []).filter(function(handCard) {
          return !(
            handCard.value === $scope.pendingPlayCard.value &&
            handCard.suit === $scope.pendingPlayCard.suit
          );
        });
      }

      $scope.pendingPlayCard = null;
    }

    syncTurnState(data);
  });

  socket.on('history_updated', function(data) {
    $scope.roundHistory = data.history || [];
  });

  socket.on('quick_chat_received', function(data) {
    var senderName = data && data.senderName ? data.senderName : 'Jogador';
    var senderId = data && data.senderId ? data.senderId : '';
    var message = data && data.message ? data.message : '';
    var isMine = !!senderId && senderId === socket.id();

    if (!message) {
      return;
    }

    addQuickChatMessage({
      senderName: senderName,
      message: message,
      isMine: isMine
    });

    $scope.quickChatToast = {
      senderName: isMine ? 'Você' : senderName,
      message: message,
      isMine: isMine
    };

    if (quickChatToastTimer) {
      $timeout.cancel(quickChatToastTimer);
    }

    quickChatToastTimer = $timeout(function() {
      $scope.quickChatToast = null;
      quickChatToastTimer = null;
    }, 2200);

    playSound('quickChat', { isMine: isMine });
  });

  socket.on('trick_resolved', function(data) {
    syncTurnState(data);
    updatePlayerStates(data.playerStates);
    $scope.isMyTurn = false;

    if (data.isTie) {
      $scope.toastMessage = 'Bucha! ' + data.starterName + ' mantém a vez.';
      $scope.toastClass = 'neon-red';
      playSound('trickTie');
    } else {
      $scope.toastMessage =
        data.winnerName +
        ' venceu a vaza com ' +
        data.winningCard.value +
        ' ' +
        $scope.getSuitSymbol(data.winningCard.suit);
      $scope.toastClass = 'neon-blue';

      if ($scope.tableCards) {
        var winningCard = $scope.tableCards.find(function(tableCard) {
          return tableCard.playerName === data.winnerName;
        });

        if (winningCard) {
          winningCard.isWinner = true;
        }
      }

      playSound('trickWon', {
        isMine: data.winnerName === $scope.data.playerName.trim()
      });
    }

    $timeout(function() {
      $scope.toastMessage = null;
    }, 2200);
  });

  socket.on('player_eliminated', function(data) {
    showMessage('Jogador eliminado: ' + data.name, 'error');
  });

  socket.on('round_results', function(data) {
    $scope.currentView = 'round_results';
    $scope.roundResults = data.results || [];
    $scope.tableCards = [];
    $scope.myHand = [];
    $scope.isMyTurn = false;
    $scope.pendingPlayCard = null;
    updatePlayerStates(data.playerStates);
    showMessage('Rodada finalizada. A próxima começa em 7 segundos.', 'success');
  });

  socket.on('new_round_started', function(data) {
    $scope.players = data.players || $scope.players;
    $scope.currentView = 'table';
    $scope.roomStatus = 'BETTING';
    $scope.currentRound = data.round || ($scope.currentRound + 1);
    $scope.currentTrump = data.trump;
    $scope.cardsPerPlayer = data.cardsPerPlayer || 5;
    $scope.betValue = 0;
    $scope.betError = '';
    $scope.roundHistory = [];
    $scope.tableCards = [];
    $scope.roundResults = [];
    $scope.pendingPlayCard = null;
    $scope.gameOver = null;
    $scope.gameSummary = null;
    clearQuickChatState();
    $scope.rematch = {
      acceptedPlayers: [],
      totalPlayers: 0,
      requestedBy: '',
      hasRequested: false
    };
    syncTurnState(data);
    var myPlayerState = getMyPlayerState();
    playSound('roundStart');
    $scope.betValue = myPlayerState ? (myPlayerState.guaranteedTricks || 0) : 0;
    showMessage('Nova rodada começou!', 'success');
  });

  socket.on('game_over', function(data) {
    $scope.currentView = 'game_over';
    $scope.gameOver = data;
    $scope.gameSummary = buildGameSummary(data.playerStates);
    $scope.pendingPlayCard = null;
    $scope.showHistoryPanel = false;
    $scope.quickChatOpen = false;
    updatePlayerStates(data.playerStates);
    $scope.rematch = {
      acceptedPlayers: [],
      totalPlayers: 0,
      requestedBy: '',
      hasRequested: false
    };
    playSound(data.winner === $scope.data.playerName.trim() ? 'gameWon' : 'gameLost');
    showMessage('Fim de jogo! Vencedor: ' + data.winner, 'success');
  });

  socket.on('player_removed', function(data) {
    showMessage(data.message || 'Um jogador saiu da sala.', 'error');
  });

  socket.on('room_closed', function(data) {
    updateUrlWithRoomCode('');
    resetToLobby();
    showMessage(data.message || 'A sala foi encerrada.', 'error');
  });

  socket.on('rematch_updated', function(data) {
    $scope.rematch.acceptedPlayers = data.acceptedPlayers || [];
    $scope.rematch.totalPlayers = data.totalPlayers || 0;
    $scope.rematch.requestedBy = data.requestedBy || '';

    if (!$scope.rematch.hasRequested && data.requestedBy) {
      showMessage(data.requestedBy + ' quer jogar novamente. Confirme para iniciar outra partida.', 'success');
    }
  });

  socket.on('rematch_started', function(data) {
    showMessage(data.message || 'Nova partida iniciada!', 'success');
  });

  socket.on('error', function(data) {
    $scope.pendingPlayCard = null;
    showMessage(data.message, 'error');
  });

  $scope.getSuitSymbol = function(suit) {
    switch (suit) {
      case 'ouros':
        return '🟡';
      case 'copas':
        return '🍷';
      case 'espadas':
        return '⚔️';
      case 'paus':
        return '🌿';
      default:
        return '';
    }
  };

  $scope.getCardColor = function(suit) {
    switch (suit) {
      case 'ouros':
        return '#F59E0B';
      case 'copas':
        return '#EF4444';
      case 'espadas':
        return '#3B82F6';
      case 'paus':
        return '#10B981';
      default:
        return '#333';
    }
  };

  $scope.getPhaseLabel = function() {
    if ($scope.roomStatus === 'BETTING') {
      return 'Apostas';
    }

    if ($scope.roomStatus === 'PLAYING') {
      return 'Jogando';
    }

    if ($scope.roomStatus === 'RESOLVING_TRICK') {
      return 'Fechando vaza';
    }

    return 'Rodada';
  };

  $scope.getStatusBoardHint = function() {
    if ($scope.roomStatus === 'BETTING') {
      return 'Acompanhe quem já apostou, quantas cartas cada pessoa tem e quem fala agora.';
    }

    return 'Acompanhe quem está na vez, quantas cartas restam e quantas vazas cada jogador já fez.';
  };

  $scope.getTurnBannerMessage = function() {
    if ($scope.roomStatus === 'PLAYING') {
      return $scope.isMyTurn
        ? 'Sua vez de jogar. Escolha uma carta da sua mão.'
        : 'Aguarde um instante. O outro jogador está escolhendo a carta.';
    }

    if ($scope.roomStatus === 'BETTING') {
      return $scope.isMyTurn
        ? 'Sua vez de apostar. Escolha quantas vazas você acha que vai fazer.'
        : 'Aguarde. Os outros jogadores ainda estão definindo as apostas.';
    }

    return 'A rodada está em andamento.';
  };

  $scope.getCompletedTricks = function() {
    return ($scope.roundHistory || []).length;
  };

  $scope.getRoundResultStatus = function(result) {
    if (!result) {
      return '';
    }

    if (result.eliminated) {
      return 'eliminated';
    }

    if ((result.penalty || 0) === 0) {
      return 'perfect';
    }

    return 'penalty';
  };

  $scope.getRoundResultLabel = function(result) {
    if (!result) {
      return '';
    }

    if (result.eliminated) {
      return 'Eliminado';
    }

    if ((result.penalty || 0) === 0) {
      return 'Acertou';
    }

    return 'Perdeu vida';
  };

  $scope.getSoundButtonLabel = function() {
    return $scope.soundEnabled ? 'Som ligado' : 'Som desligado';
  };

  $scope.isGameWinner = function(playerName) {
    return !!($scope.gameOver && $scope.gameOver.winner === playerName);
  };

  $scope.isRoomOwner = function(player) {
    if (!player || !$scope.players || !$scope.players.length) {
      return false;
    }

    return $scope.players[0].socketId === player.socketId;
  };

  $scope.canStartMatch = function() {
    return ($scope.players || []).length >= 2;
  };

  $scope.getRoomStatusLabel = function() {
    var totalPlayers = ($scope.players || []).length;

    if (totalPlayers < 2) {
      return 'Aguardando mais jogadores';
    }

    return 'Sala pronta para iniciar';
  };

  $scope.getQuickChatButtonLabel = function() {
    return $scope.quickChatOpen ? 'Fechar mensagens' : 'Mensagens rápidas';
  };
});
