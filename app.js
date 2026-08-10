var app = angular.module('tfApp', []);

function getApiBaseUrl() {
  var configuredUrl = window.TF_API_URL || 'http://localhost:3000';
  return configuredUrl.replace(/\/$/, '');
}

function getStoredPlayerId() {
  var storageKey = 'tfPlayerId';
  var existingId = window.localStorage.getItem(storageKey);

  if (existingId) {
    return existingId;
  }

  var newId = 'player-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  window.localStorage.setItem(storageKey, newId);
  return newId;
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
  var playerId = getStoredPlayerId();
  var sessionStorageKey = 'tfSession';
  var invitedRoomCode = getRoomCodeFromUrl();
  $scope.currentView = 'login';
  $scope.data = {
    playerName: window.localStorage.getItem('tfPlayerName') || '',
    roomCodeInput: invitedRoomCode
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
  $scope.reconnectPrompt = null;

  var messageTimeout;

  function savePlayerName() {
    window.localStorage.setItem('tfPlayerName', ($scope.data.playerName || '').trim());
  }

  function saveSession() {
    if (!$scope.currentRoomCode || !$scope.data.playerName || !$scope.data.playerName.trim()) {
      return;
    }

    window.localStorage.setItem(sessionStorageKey, JSON.stringify({
      roomCode: $scope.currentRoomCode,
      playerName: $scope.data.playerName.trim(),
      playerId: playerId
    }));
  }

  function clearSession() {
    window.localStorage.removeItem(sessionStorageKey);
  }

  function clearReconnectPrompt() {
    $scope.reconnectPrompt = null;
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

  function resetToLoginState(clearSavedSession) {
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
    resetRematchState();
    clearReconnectPrompt();
    $scope.data.roomCodeInput = getRoomCodeFromUrl();

    if (clearSavedSession) {
      clearSession();
    }
  }

  function getSavedSession() {
    var rawValue = window.localStorage.getItem(sessionStorageKey);

    if (!rawValue) {
      return null;
    }

    try {
      return JSON.parse(rawValue);
    } catch (_error) {
      clearSession();
      return null;
    }
  }

  function restoreSessionIfNeeded() {
    var savedSession = getSavedSession();

    if (!savedSession || !savedSession.roomCode || !savedSession.playerName || !savedSession.playerId) {
      $scope.reconnectPrompt = null;
      return;
    }

    if (!$scope.data.playerName || !$scope.data.playerName.trim()) {
      $scope.data.playerName = savedSession.playerName;
    }

    $scope.reconnectPrompt = savedSession;
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

  function createEmptyRematchState() {
    return {
      acceptedPlayers: [],
      totalPlayers: 0,
      requestedBy: '',
      hasRequested: false
    };
  }

  function resetRematchState() {
    $scope.rematch = createEmptyRematchState();
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

  function resetToLobby() {
    resetToLoginState(true);
    $scope.message = '';
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

  $scope.resumeSavedSession = function() {
    if (!$scope.reconnectPrompt) {
      return;
    }

    $scope.data.playerName = $scope.reconnectPrompt.playerName;
    savePlayerName();
    socket.emit('reconnect_room', $scope.reconnectPrompt);
    $scope.reconnectPrompt = null;
  };

  $scope.dismissSavedSession = function() {
    clearReconnectPrompt();
    clearSession();
    updateUrlWithRoomCode('');
    $scope.data.roomCodeInput = '';
  };

  $scope.closeHistory = function() {
    $scope.showHistoryPanel = false;
  };

  $scope.openHistory = function() {
    if (!$scope.roundHistory || !$scope.roundHistory.length) {
      showMessage('O histórico aparece depois que a primeira vaza é resolvida.', 'error');
      return;
    }

    $scope.showHistoryPanel = true;
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

    $scope.rematch.hasRequested = true;
    socket.emit('request_rematch', { roomCode: $scope.currentRoomCode });
  };

  $scope.leaveToLobby = function() {
    resetToLobby();
    showMessage('Você voltou para a tela inicial.', 'success');
  };

  $scope.quickMatch = function() {
    if (!$scope.data.playerName || !$scope.data.playerName.trim()) {
      showMessage('Por favor, digite seu apelido antes de jogar.', 'error');
      return;
    }

    savePlayerName();
    socket.emit('quick_match', {
      playerName: $scope.data.playerName.trim(),
      playerId: playerId
    });
  };

  $scope.createRoom = function() {
    if (!$scope.data.playerName || !$scope.data.playerName.trim()) {
      showMessage('Por favor, digite seu apelido antes de criar uma sala.', 'error');
      return;
    }

    savePlayerName();
    socket.emit('create_room', {
      playerName: $scope.data.playerName.trim(),
      playerId: playerId,
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
    socket.emit('join_room', {
      playerName: $scope.data.playerName.trim(),
      playerId: playerId,
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

    socket.emit('make_bet', {
      roomCode: $scope.currentRoomCode,
      bet: $scope.betValue
    });
  };

  $scope.playCard = function(card) {
    if (!$scope.isMyTurn || $scope.roomStatus !== 'PLAYING' || $scope.pendingPlayCard) {
      return;
    }

    $scope.pendingPlayCard = card;
    $scope.isMyTurn = false;

    socket.emit('play_card', {
      roomCode: $scope.currentRoomCode,
      card: card
    });
  };

  socket.on('room_created', function(data) {
    $scope.showHistoryPanel = false;
    $scope.currentView = 'room';
    $scope.currentRoomCode = data.roomCode;
    updateUrlWithRoomCode(data.roomCode);
    clearReconnectPrompt();
    saveSession();
    showMessage('Sala criada com sucesso!', 'success');
  });

  socket.on('room_joined', function(data) {
    $scope.showHistoryPanel = false;
    $scope.currentView = 'room';
    $scope.currentRoomCode = data.roomCode;
    updateUrlWithRoomCode(data.roomCode);
    clearReconnectPrompt();
    saveSession();
    showMessage('Conectado à sala com sucesso!', 'success');
  });

  socket.on('room_updated', function(data) {
    $scope.players = data.players || [];
    if ($scope.currentRoomCode) {
      saveSession();
    }
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
    resetRematchState();
    syncTurnState(data);
    var myPlayerState = getMyPlayerState();
    $scope.betValue = myPlayerState ? (myPlayerState.guaranteedTricks || 0) : 0;
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

  socket.on('trick_resolved', function(data) {
    syncTurnState(data);
    updatePlayerStates(data.playerStates);
    $scope.isMyTurn = false;

    if (data.isTie) {
      $scope.toastMessage = 'Bucha! ' + data.starterName + ' mantém a vez.';
      $scope.toastClass = 'neon-red';
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
    resetRematchState();
    syncTurnState(data);
    var myPlayerState = getMyPlayerState();
    $scope.betValue = myPlayerState ? (myPlayerState.guaranteedTricks || 0) : 0;
    showMessage('Nova rodada começou!', 'success');
  });

  socket.on('game_over', function(data) {
    $scope.currentView = 'game_over';
    $scope.gameOver = data;
    $scope.pendingPlayCard = null;
    $scope.showHistoryPanel = false;
    updatePlayerStates(data.playerStates);
    resetRematchState();
    showMessage('Fim de jogo! Vencedor: ' + data.winner, 'success');
  });

  socket.on('session_restored', function(data) {
    $scope.currentRoomCode = data.roomCode || $scope.currentRoomCode;
    updateUrlWithRoomCode($scope.currentRoomCode);
    $scope.players = data.players || [];
    $scope.currentRound = data.round || 0;
    $scope.currentTrump = data.trump || null;
    $scope.cardsPerPlayer = data.cardsPerPlayer || 0;
    $scope.tableCards = data.tableCards || [];
    $scope.roundHistory = data.history || [];
    $scope.myHand = data.hand || [];
    $scope.roundResults = data.roundResults || [];
    $scope.gameOver = data.gameOver || null;
    $scope.pendingPlayCard = null;
    $scope.showHistoryPanel = false;
    $scope.rematch.acceptedPlayers = (data.rematch && data.rematch.acceptedPlayers) || [];
    $scope.rematch.totalPlayers = (data.rematch && data.rematch.totalPlayers) || 0;

    syncTurnState(data);

    if (data.status === 'WAITING') {
      $scope.currentView = 'room';
    } else if (data.status === 'GAME_OVER' && data.gameOver) {
      $scope.currentView = 'game_over';
    } else if (data.status === 'ROUND_END' && $scope.roundResults.length) {
      $scope.currentView = 'round_results';
    } else {
      $scope.currentView = 'table';
    }

    clearReconnectPrompt();
    saveSession();
    showMessage('Sua sessão foi restaurada.', 'success');
  });

  socket.on('room_paused', function(data) {
    $scope.pendingPlayCard = null;
    $scope.isMyTurn = false;
    $scope.roomStatus = 'PAUSED';
    showMessage(data.message || 'A partida foi pausada.', 'error');
  });

  socket.on('match_resumed', function(data) {
    showMessage(data.message || 'A partida foi retomada.', 'success');
  });

  socket.on('match_cancelled', function(data) {
    resetToLoginState(true);
    updateUrlWithRoomCode('');
    showMessage(data.message || 'A partida foi cancelada e a sala voltou para o lobby.', 'error');
  });

  socket.on('player_removed', function(data) {
    showMessage(data.message || 'Um jogador saiu da sala.', 'error');
  });

  socket.on('player_disconnected', function(data) {
    showMessage(data.message || 'Um jogador ficou offline.', 'error');
  });

  socket.on('room_closed', function(data) {
    resetToLoginState(true);
    updateUrlWithRoomCode('');
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

    if (data && data.message === 'Não foi possível restaurar a sua sessão.') {
      clearSession();
      clearReconnectPrompt();
      updateUrlWithRoomCode('');
    }

    showMessage(data.message, 'error');
  });

  socket.on('connect', function() {
    restoreSessionIfNeeded();
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

    if ($scope.roomStatus === 'PAUSED') {
      return 'Partida pausada';
    }

    return 'Rodada';
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

  $scope.isRoomOwner = function(player) {
    if (!player || !$scope.players || !$scope.players.length) {
      return false;
    }

    return $scope.players[0].socketId === player.socketId;
  };

  $scope.canStartMatch = function() {
    return ($scope.players || []).filter(function(player) {
      return player.connected !== false;
    }).length >= 2;
  };

  $scope.getRoomStatusLabel = function() {
    var totalPlayers = ($scope.players || []).filter(function(player) {
      return player.connected !== false;
    }).length;

    if (totalPlayers < 2) {
      return 'Aguardando mais jogadores';
    }

    if ($scope.roomStatus === 'PAUSED') {
      return 'Partida pausada';
    }

    return 'Sala pronta para iniciar';
  };
});
