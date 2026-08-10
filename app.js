var app = angular.module('tfApp', []);

function getApiBaseUrl() {
  var configuredUrl = window.TF_API_URL || 'http://localhost:3000';
  return configuredUrl.replace(/\/$/, '');
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

  var messageTimeout;

  function savePlayerName() {
    window.localStorage.setItem('tfPlayerName', ($scope.data.playerName || '').trim());
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
    socket.emit('quick_match', { playerName: $scope.data.playerName.trim() });
  };

  $scope.createRoom = function() {
    if (!$scope.data.playerName || !$scope.data.playerName.trim()) {
      showMessage('Por favor, digite seu apelido antes de criar uma sala.', 'error');
      return;
    }

    savePlayerName();
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
    updateUrlWithRoomCode(data.roomCode);
    showMessage('Sala criada com sucesso!', 'success');
  });

  socket.on('room_joined', function(data) {
    $scope.showHistoryPanel = false;
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
    $scope.rematch = {
      acceptedPlayers: [],
      totalPlayers: 0,
      requestedBy: '',
      hasRequested: false
    };
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
    $scope.rematch = {
      acceptedPlayers: [],
      totalPlayers: 0,
      requestedBy: '',
      hasRequested: false
    };
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
    $scope.rematch = {
      acceptedPlayers: [],
      totalPlayers: 0,
      requestedBy: '',
      hasRequested: false
    };
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
});
