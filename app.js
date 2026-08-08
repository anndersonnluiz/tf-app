var app = angular.module('tfApp', []);

function getApiBaseUrl() {
  var configuredUrl = window.TF_API_URL || 'http://localhost:3000';
  return configuredUrl.replace(/\/$/, '');
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
    playerName: '',
    roomCodeInput: ''
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
  $scope.message = '';
  $scope.messageType = 'success';

  var messageTimeout;

  function updatePlayerStates(playerStates) {
    if (playerStates) {
      $scope.playerStates = playerStates;
    }
  }

  function syncTurnState(data) {
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

  function getMyPlayerState() {
    return ($scope.playerStates || []).find(function(player) {
      return player.name === $scope.data.playerName.trim();
    });
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
    $scope.message = '';
  }

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
      showMessage('O histÃ³rico aparece depois que a primeira vaza Ã© resolvida.', 'error');
      return;
    }

    $scope.showHistoryPanel = !$scope.showHistoryPanel;
  };

  $scope.playAgain = function() {
    resetToLobby();
    showMessage('Você voltou para a tela inicial.', 'success');
  };

  $scope.quickMatch = function() {
    if (!$scope.data.playerName || !$scope.data.playerName.trim()) {
      showMessage('Por favor, digite seu apelido antes de jogar.', 'error');
      return;
    }

    socket.emit('quick_match', { playerName: $scope.data.playerName.trim() });
  };

  $scope.createRoom = function() {
    if (!$scope.data.playerName || !$scope.data.playerName.trim()) {
      showMessage('Por favor, digite seu apelido antes de criar uma sala.', 'error');
      return;
    }

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
    showMessage('Sala criada com sucesso!', 'success');
  });

  socket.on('room_joined', function(data) {
    $scope.showHistoryPanel = false;
    $scope.currentView = 'room';
    $scope.currentRoomCode = data.roomCode;
    showMessage('Conectado à sala com sucesso!', 'success');
  });

  socket.on('room_updated', function(data) {
    $scope.players = data.players || [];
    syncTurnState(data);
  });

  socket.on('round_started', function(data) {
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
    syncTurnState(data);
    var myPlayerState = getMyPlayerState();
    $scope.betValue = myPlayerState ? (myPlayerState.guaranteedTricks || 0) : 0;
    showMessage('Fase de apostas iniciada!', 'success');
  });

  socket.on('turn_update', function(data) {
    syncTurnState(data);
  });

  socket.on('playing_started', function(data) {
    $scope.roomStatus = 'PLAYING';
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
    updatePlayerStates(data.playerStates);

    if (data.isTie) {
      $scope.toastMessage = 'Bucha! ' + data.starterName + ' mantém a vez.';
      $scope.toastClass = 'neon-red';
    } else {
      $scope.toastMessage =
        data.winnerName +
        ' levou a mão com ' +
        data.winningCard.value +
        ' ' +
        $scope.getSuitSymbol(data.winningCard.suit) +
        '!';
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
    }, 2500);
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
    showMessage('Fim de jogo! Vencedor: ' + data.winner, 'success');
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
});
