var app = angular.module('tfApp', []);

function getApiBaseUrl() {
  var configuredUrl = window.TF_API_URL || 'http://localhost:3000';
  return configuredUrl.replace(/\/$/, '');
}

// Factory para gerenciar a conexão Socket.io de forma integrada ao ciclo de digestão do Angular
app.factory('socket', function($rootScope) {
  // Conecta ao servidor backend
  var socket = io.connect(getApiBaseUrl());

  return {
    id: function() { return socket.id; },
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

// Controller Principal do Lobby
app.controller('LobbyController', function($scope, $timeout, socket) {
  $scope.currentView = 'login';

  $scope.data = {
    playerName: '',
    roomCodeInput: ''
  };

  $scope.currentRoomCode = '';
  $scope.players = [];

  $scope.currentRound = 0;
  $scope.currentTrump = null;
  $scope.cardsPerPlayer = 5;
  $scope.myHand = [];
  $scope.tableCards = [];
  $scope.roomStatus = '';
  $scope.isMyTurn = false;
  $scope.betValue = 0;
  $scope.betError = '';

  $scope.roundHistory = [];
  $scope.showHistoryModal = false;
  $scope.toastMessage = null;
  $scope.toastClass = '';

  $scope.roundResults = [];
  $scope.gameOver = null;

  $scope.message = '';
  $scope.messageType = 'success';

  var messageTimeout;

  function showMessage(msg, type) {
    $scope.message = msg;
    $scope.messageType = type || 'success';

    if (messageTimeout) {
      $timeout.cancel(messageTimeout);
    }

    messageTimeout = $timeout(function() {
      $scope.message = '';
    }, 4000);
  }

  $scope.quickMatch = function() {
    if (!$scope.data.playerName || !$scope.data.playerName.trim()) {
      showMessage('Por favor, digite seu apelido antes de jogar.', 'error');
      return;
    }
    socket.emit('quick_match', { playerName: $scope.data.playerName });
  };

  $scope.createRoom = function() {
    if (!$scope.data.playerName || !$scope.data.playerName.trim()) {
      showMessage('Por favor, digite seu apelido antes de criar uma sala.', 'error');
      return;
    }
    socket.emit('create_room', { playerName: $scope.data.playerName, isPrivate: true });
  };

  $scope.joinRoom = function() {
    if (!$scope.data.playerName || !$scope.data.playerName.trim()) {
      showMessage('Por favor, digite seu apelido antes de entrar.', 'error');
      return;
    }
    if (!$scope.data.roomCodeInput || $scope.data.roomCodeInput.trim().length !== 4) {
      showMessage('O código da sala deve ter exatos 4 caracteres.', 'error');
      return;
    }

    var code = $scope.data.roomCodeInput.trim().toUpperCase();
    socket.emit('join_room', { playerName: $scope.data.playerName, roomCode: code });
  };

  $scope.startGame = function() {
    if ($scope.currentRoomCode) {
      socket.emit('start_game', { roomCode: $scope.currentRoomCode });
    }
  };

  $scope.incrementBet = function() {
    if ($scope.betValue < $scope.cardsPerPlayer) {
      $scope.betValue++;
      $scope.betError = '';
    }
  };

  $scope.decrementBet = function() {
    if ($scope.betValue > 0) {
      $scope.betValue--;
      $scope.betError = '';
    }
  };

  $scope.makeBet = function() {
    socket.emit('make_bet', { roomCode: $scope.currentRoomCode, bet: $scope.betValue });
  };

  $scope.playCard = function(card) {
    if (!$scope.isMyTurn || $scope.roomStatus !== 'PLAYING') {
      return;
    }

    var idx = $scope.myHand.indexOf(card);
    if (idx > -1) {
      $scope.myHand.splice(idx, 1);
    }

    socket.emit('play_card', { roomCode: $scope.currentRoomCode, card: card });
  };

  socket.on('room_created', function(data) {
    $scope.currentView = 'room';
    $scope.currentRoomCode = data.roomCode;
    showMessage('Sala criada com sucesso!', 'success');
  });

  socket.on('room_joined', function(data) {
    $scope.currentView = 'room';
    $scope.currentRoomCode = data.roomCode;
    showMessage('Conectado à sala com sucesso!', 'success');
  });

  socket.on('room_updated', function(data) {
    $scope.players = data.players;
  });

  socket.on('round_started', function(data) {
    $scope.currentView = 'table';
    $scope.roomStatus = 'BETTING';
    $scope.currentRound = data.round;
    $scope.cardsPerPlayer = data.cardsPerPlayer || 5;
    $scope.currentTrump = data.trump;
    $scope.betValue = 0;
    $scope.betError = '';
    $scope.roundHistory = [];
    showMessage('Fase de apostas iniciada!', 'success');
  });

  socket.on('turn_update', function(data) {
    $scope.isMyTurn = (socket.id() === data.currentPlayerId);
    if ($scope.isMyTurn) {
      $scope.betError = '';
    }
  });

  socket.on('playing_started', function(data) {
    $scope.roomStatus = 'PLAYING';
    $scope.isMyTurn = false;
    showMessage(data.message, 'success');
  });

  socket.on('bet_error', function(data) {
    $scope.betError = data.message;
  });

  socket.on('hand_dealt', function(data) {
    $scope.myHand = data.hand;
  });

  socket.on('table_updated', function(data) {
    $scope.tableCards = data.tableCards;
  });

  socket.on('history_updated', function(data) {
    $scope.roundHistory = data.history;
  });

  socket.on('trick_resolved', function(data) {
    if (data.isTie) {
      $scope.toastMessage = 'BUCHA! ' + data.starterName + ' mantém a vez!';
      $scope.toastClass = 'neon-red';
    } else {
      $scope.toastMessage = data.winnerName + ' levou a mão com ' + data.winningCard.value + ' ' + $scope.getSuitSymbol(data.winningCard.suit) + '!';
      $scope.toastClass = 'neon-blue';

      if ($scope.tableCards) {
        var winnerTc = $scope.tableCards.find(function(tc) { return tc.playerName === data.winnerName; });
        if (winnerTc) {
          winnerTc.isWinner = true;
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
    $scope.roundResults = data.results;
    $scope.tableCards = [];
    $scope.myHand = [];
    $scope.isMyTurn = false;
    showMessage('Rodada finalizada! Nova rodada em 7 segundos...', 'success');
  });

  socket.on('new_round_started', function(data) {
    $scope.currentView = 'table';
    $scope.roomStatus = 'BETTING';
    $scope.currentTrump = data.trump;
    $scope.cardsPerPlayer = data.cardsPerPlayer || 5;
    $scope.currentRound = data.cardsPerPlayer || 5;
    $scope.betValue = 0;
    $scope.betError = '';
    $scope.roundHistory = [];
    $scope.tableCards = [];
    $scope.roundResults = [];
    showMessage('Nova rodada começou!', 'success');
  });

  socket.on('game_over', function(data) {
    $scope.currentView = 'game_over';
    $scope.gameOver = data;
    showMessage('Fim de jogo! Vencedor: ' + data.winner, 'success');
  });

  socket.on('error', function(data) {
    showMessage(data.message, 'error');
  });

  $scope.getSuitSymbol = function(suit) {
    switch (suit) {
      case 'ouros': return '🟡';
      case 'copas': return '🍷';
      case 'espadas': return '⚔️';
      case 'paus': return '🌿';
      default: return '';
    }
  };

  $scope.getCardColor = function(suit) {
    switch (suit) {
      case 'ouros': return '#F59E0B';
      case 'copas': return '#EF4444';
      case 'espadas': return '#3B82F6';
      case 'paus': return '#10B981';
      default: return '#333';
    }
  };
});
